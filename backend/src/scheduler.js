import cron from 'node-cron';
import { db } from './db.js';
import { processRegionCheck } from './incidents.js';

const TIMEOUT_MS = 5000;
const FAST_RECHECK_DELAY_MS = 8000;

// Identifies which "region" this process's checks are attributed to. In
// docker-compose, three instances of this same image run with different
// REGION values (see docker-compose.yml) so quorum has real, independent
// processes to reconcile — see DECISIONS.md for what's genuinely
// distributed here vs. simulated in local dev.
export const REGION = process.env.REGION || 'local';

const insertCheck = db.prepare(`
  INSERT INTO checks (url_id, region, status_code, response_time_ms, is_up, error, checked_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Guards against stacking multiple fast-recheck timers for the same URL if
// several regular checks land while one is already pending confirmation.
const pendingFastRechecks = new Set();

/**
 * Pings a single URL from this process's region, records the raw check,
 * and runs it through the incident state machine. Never throws — network
 * failures are captured as a down check rather than an unhandled rejection.
 */
export async function checkUrl(urlRow) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = performance.now();

  let isUp;
  let checkedAtIso;

  try {
    const res = await fetch(urlRow.url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': `uptime-monitor/1.0 (${REGION})` },
    });
    const elapsed = Math.round(performance.now() - start);
    isUp = res.status >= 200 && res.status < 400;
    checkedAtIso = new Date().toISOString();

    insertCheck.run(urlRow.id, REGION, res.status, elapsed, isUp ? 1 : 0, null, checkedAtIso);
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    const reason = err.name === 'AbortError' ? 'TIMEOUT' : (err.code || err.message || 'UNKNOWN_ERROR');
    isUp = false;
    checkedAtIso = new Date().toISOString();

    insertCheck.run(urlRow.id, REGION, null, elapsed, 0, reason, checkedAtIso);
  } finally {
    clearTimeout(timeout);
  }

  const { scheduleFastRecheck } = processRegionCheck(urlRow.id, urlRow.url, REGION, isUp, checkedAtIso);

  const key = `${urlRow.id}:${REGION}`;
  if (scheduleFastRecheck && !pendingFastRechecks.has(key)) {
    pendingFastRechecks.add(key);
    setTimeout(() => {
      pendingFastRechecks.delete(key);
      checkUrl(urlRow).catch((err) => console.error('[scheduler] fast recheck failed', err));
    }, FAST_RECHECK_DELAY_MS);
  }
}

/**
 * Runs a health check pass across every registered URL concurrently.
 */
export async function runCheckPass() {
  const urls = db.prepare('SELECT id, url FROM urls').all();
  if (urls.length === 0) return;

  const results = await Promise.allSettled(urls.map(checkUrl));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    console.error(`[scheduler] ${failed.length} check(s) threw unexpectedly`);
  }
}

let cronTask = null;

/**
 * Starts the cron job. Runs once immediately on boot, then every minute.
 */
export function startScheduler() {
  runCheckPass().catch((err) => console.error('[scheduler] initial pass failed', err));

  cronTask = cron.schedule('* * * * *', () => {
    runCheckPass().catch((err) => console.error('[scheduler] scheduled pass failed', err));
  });

  console.log(`[scheduler:${REGION}] running health checks every 60s (fast recheck after 8s on suspected failure)`);
}

export function stopScheduler() {
  if (cronTask) cronTask.stop();
}
