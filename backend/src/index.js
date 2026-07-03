import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import urlsRouter from './routes/urls.js';
import eventsRouter from './routes/events.js';
import { startScheduler, stopScheduler, REGION } from './scheduler.js';
import { runSslCheckPass } from './ssl.js';
import { db } from './db.js'; // ensures schema is created before anything else runs

// ROLE=api (default) runs the HTTP API + this process's own region checker.
// ROLE=checker runs ONLY a region checker against the shared DB — no HTTP
// server. docker-compose uses this to run additional regions as separate,
// genuinely independent OS processes (see docker-compose.yml + DECISIONS.md
// for what's real multi-process behavior here vs. simulated geography).
const ROLE = process.env.ROLE || 'api';

let sslCronTask = null;

function startSslSchedule() {
  runSslCheckPass().catch((err) => console.error('[ssl] initial pass failed', err));
  // Certs don't change minute to minute — check every 6 hours.
  sslCronTask = cron.schedule('0 */6 * * *', () => {
    runSslCheckPass().catch((err) => console.error('[ssl] scheduled pass failed', err));
  });
}

if (ROLE === 'checker') {
  console.log(`[boot] starting in checker-only mode, region=${REGION}`);
  startScheduler();

  const shutdown = (signal) => {
    console.log(`[checker:${REGION}] received ${signal}, shutting down gracefully`);
    stopScheduler();
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} else {
  const app = express();
  const PORT = process.env.PORT || 4000;

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true, region: REGION }));
  app.use('/api/urls', urlsRouter);
  app.use('/api/events', eventsRouter);

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = app.listen(PORT, () => {
    console.log(`[server] listening on :${PORT} (region=${REGION})`);
    startScheduler();
    startSslSchedule();
  });

  // Docker sends SIGTERM on `docker compose down`/`docker stop`. Without
  // this, the process is killed mid-request or mid-write instead of
  // finishing cleanly.
  function shutdown(signal) {
    console.log(`[server] received ${signal}, shutting down gracefully`);
    stopScheduler();
    if (sslCronTask) sslCronTask.stop();
    server.close(() => {
      try { db.close(); } catch { /* already closed */ }
      console.log('[server] closed cleanly');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
