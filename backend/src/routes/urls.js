import { Router } from 'express';
import { db } from '../db.js';
import { checkUrl } from '../scheduler.js';
import { checkSslExpiry } from '../ssl.js';
import { normalizeUrl } from '../validators.js';
import { eventBus } from '../events.js';

const router = Router();

const getLatestCheck = db.prepare(`
  SELECT status_code, response_time_ms, is_up, error, checked_at, region
  FROM checks WHERE url_id = ? ORDER BY checked_at DESC LIMIT 1
`);

const getHistory = db.prepare(`
  SELECT response_time_ms, is_up, checked_at
  FROM checks WHERE url_id = ? ORDER BY checked_at DESC LIMIT 20
`);

const getUptimeWindow = db.prepare(`
  SELECT
    SUM(CASE WHEN is_up = 1 THEN 1 ELSE 0 END) AS up_count,
    COUNT(*) AS total
  FROM checks WHERE url_id = ? AND checked_at >= ?
`);

const getOpenIncident = db.prepare(`
  SELECT id, started_at FROM incidents WHERE url_id = ? AND resolved_at IS NULL
`);

const getRecentIncidents = db.prepare(`
  SELECT started_at, resolved_at, duration_seconds
  FROM incidents WHERE url_id = ? AND resolved_at IS NOT NULL
  ORDER BY resolved_at DESC LIMIT 3
`);

const getRegionBreakdown = db.prepare(`
  SELECT region, confirmed_down, updated_at
  FROM region_state WHERE url_id = ? ORDER BY region ASC
`);

const getSslInfo = db.prepare('SELECT valid_to, days_remaining, checked_at, error FROM ssl_info WHERE url_id = ?');

function serializeMonitor(urlRow) {
  const latest = getLatestCheck.get(urlRow.id);
  const history = getHistory.all(urlRow.id).reverse();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const uptimeWindow = getUptimeWindow.get(urlRow.id, since24h);
  const openIncident = getOpenIncident.get(urlRow.id);
  const recentIncidents = getRecentIncidents.all(urlRow.id);
  const regionRows = getRegionBreakdown.all(urlRow.id);
  const sslRow = getSslInfo.get(urlRow.id);

  // Confirmed state drives the UI badge: a URL only reads as "down" once a
  // cross-region quorum has actually opened an incident — a single
  // region's single failed check shows as "pending" while it's being
  // confirmed, so one blip (or one region's own network hiccup) never
  // misrepresents a healthy service as down.
  let state = 'pending';
  if (latest) {
    if (openIncident) state = 'down';
    else if (latest.is_up) state = 'up';
    else state = 'pending';
  }

  const uptimePct = uptimeWindow?.total
    ? Math.round((uptimeWindow.up_count / uptimeWindow.total) * 1000) / 10
    : null;

  return {
    id: urlRow.id,
    url: urlRow.url,
    label: urlRow.label,
    createdAt: urlRow.created_at,
    state,
    uptime24h: uptimePct,
    latest: latest ? {
      statusCode: latest.status_code,
      responseTimeMs: latest.response_time_ms,
      isUp: !!latest.is_up,
      error: latest.error,
      checkedAt: latest.checked_at,
      region: latest.region,
    } : null,
    history: history.map((h) => ({
      responseTimeMs: h.response_time_ms,
      isUp: !!h.is_up,
      checkedAt: h.checked_at,
    })),
    regions: regionRows.map((r) => ({
      region: r.region,
      confirmedDown: !!r.confirmed_down,
      updatedAt: r.updated_at,
    })),
    openIncident: openIncident ? { startedAt: openIncident.started_at } : null,
    recentIncidents: recentIncidents.map((i) => ({
      startedAt: i.started_at,
      resolvedAt: i.resolved_at,
      durationSeconds: i.duration_seconds,
    })),
    ssl: sslRow ? {
      validTo: sslRow.valid_to,
      daysRemaining: sslRow.days_remaining,
      checkedAt: sslRow.checked_at,
      error: sslRow.error,
    } : null,
  };
}

// GET /api/urls — list all monitored URLs with confirmed state, per-region
// breakdown, 24h uptime %, incident history, and SSL expiry.
router.get('/', (req, res) => {
  const urlRows = db.prepare('SELECT * FROM urls ORDER BY created_at ASC').all();
  res.json(urlRows.map(serializeMonitor));
});

// POST /api/urls — register a new URL to monitor
router.post('/', async (req, res) => {
  const normalized = normalizeUrl(req.body?.url);
  if (!normalized) {
    return res.status(400).json({ error: 'Provide a valid http(s) URL, e.g. https://example.com' });
  }

  try {
    const info = db.prepare('INSERT INTO urls (url, label) VALUES (?, ?)')
      .run(normalized, req.body?.label || null);

    const urlRow = { id: Number(info.lastInsertRowid), url: normalized };

    eventBus.emit('event', { type: 'url_added', urlId: urlRow.id, url: normalized });

    // Fire an immediate check (and, for https, an SSL check) so the UI has
    // data right away instead of waiting up to 60s for the next pass.
    checkUrl(urlRow).catch((err) => console.error('[urls] immediate check failed', err));
    checkSslExpiry(urlRow).catch((err) => console.error('[urls] immediate ssl check failed', err));

    res.status(201).json({ id: urlRow.id, url: normalized });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'That URL is already being monitored' });
    }
    console.error('[urls] insert failed', err);
    res.status(500).json({ error: 'Could not register URL' });
  }
});

// GET /api/urls/:id/history — full recent raw check history for one URL
router.get('/:id/history', (req, res) => {
  const rows = db.prepare(`
    SELECT status_code, response_time_ms, is_up, error, checked_at, region
    FROM checks WHERE url_id = ? ORDER BY checked_at DESC LIMIT 100
  `).all(req.params.id);

  res.json(rows.map((r) => ({
    statusCode: r.status_code,
    responseTimeMs: r.response_time_ms,
    isUp: !!r.is_up,
    error: r.error,
    checkedAt: r.checked_at,
    region: r.region,
  })));
});

// GET /api/urls/:id/incidents — confirmed outage history for one URL
router.get('/:id/incidents', (req, res) => {
  const rows = db.prepare(`
    SELECT id, started_at, resolved_at, duration_seconds
    FROM incidents WHERE url_id = ? ORDER BY started_at DESC LIMIT 50
  `).all(req.params.id);

  res.json(rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    resolvedAt: r.resolved_at,
    durationSeconds: r.duration_seconds,
    ongoing: r.resolved_at === null,
  })));
});

// DELETE /api/urls/:id — stop monitoring a URL
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM urls WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
