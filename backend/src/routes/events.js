import { Router } from 'express';
import { eventBus } from '../events.js';

const router = Router();

const HEARTBEAT_MS = 20000;

// GET /api/events — Server-Sent Events stream of check results and
// incident open/resolve events, as they happen. Used for the live
// activity log — polling makes sense for the routine status grid (cheap,
// no urgency), but these events are comparatively rare and bursty, which
// is exactly the shape push transport is for. See DECISIONS.md.
router.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disables nginx response buffering for this stream
  });
  res.flushHeaders?.();

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  send({ type: 'connected', message: 'Live feed connected' });

  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), HEARTBEAT_MS);

  eventBus.on('event', send);

  req.on('close', () => {
    clearInterval(heartbeat);
    eventBus.off('event', send);
    res.end();
  });
});

export default router;
