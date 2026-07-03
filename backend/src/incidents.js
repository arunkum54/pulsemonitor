import { db } from './db.js';
import { nextRegionState, quorumDecision } from './incidentState.js';
import { eventBus } from './events.js';

const getRegionState = db.prepare(
  'SELECT consecutive_failures, confirmed_down FROM region_state WHERE url_id = ? AND region = ?'
);

const upsertRegionState = db.prepare(`
  INSERT INTO region_state (url_id, region, consecutive_failures, confirmed_down, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(url_id, region) DO UPDATE SET
    consecutive_failures = excluded.consecutive_failures,
    confirmed_down = excluded.confirmed_down,
    updated_at = excluded.updated_at
`);

const getAllRegionStates = db.prepare(
  'SELECT region, confirmed_down FROM region_state WHERE url_id = ?'
);

const getOpenIncidentRow = db.prepare(
  'SELECT id, started_at FROM incidents WHERE url_id = ? AND resolved_at IS NULL'
);

const insertIncident = db.prepare('INSERT INTO incidents (url_id, started_at) VALUES (?, ?)');

const closeIncident = db.prepare(`
  UPDATE incidents SET resolved_at = ?, duration_seconds = ? WHERE id = ?
`);

/**
 * Processes one region's check result for one URL:
 *   1. Updates that region's own debounced state (layer 1).
 *   2. Recomputes the cross-region quorum (layer 2) and opens/resolves a
 *      URL-level incident if the quorum's verdict just changed.
 *   3. Emits live events for the activity feed.
 *
 * Returns whether this region should schedule a fast follow-up check.
 */
export function processRegionCheck(urlId, url, region, isUp, checkedAtIso) {
  const existing = getRegionState.get(urlId, region) || { consecutive_failures: 0, confirmed_down: 0 };
  const regionResult = nextRegionState(
    { consecutiveFailures: existing.consecutive_failures, confirmedDown: !!existing.confirmed_down },
    isUp
  );

  upsertRegionState.run(
    urlId,
    region,
    regionResult.consecutiveFailures,
    regionResult.confirmedDown ? 1 : 0,
    checkedAtIso
  );

  eventBus.emit('event', {
    type: 'check',
    urlId,
    url,
    region,
    isUp,
    checkedAt: checkedAtIso,
  });

  // Re-evaluate quorum across every region that has ever reported for
  // this URL, using each region's freshly-updated debounced state.
  const allStates = getAllRegionStates.all(urlId).map((r) =>
    r.region === region
      ? { region, confirmedDown: regionResult.confirmedDown }
      : { region: r.region, confirmedDown: !!r.confirmed_down }
  );

  const verdict = quorumDecision(allStates);
  const openIncident = getOpenIncidentRow.get(urlId);

  if (verdict === 'down' && !openIncident) {
    const info = insertIncident.run(urlId, checkedAtIso);
    eventBus.emit('event', {
      type: 'incident_open',
      urlId,
      url,
      startedAt: checkedAtIso,
      regions: allStates,
    });
  } else if (verdict === 'up' && openIncident) {
    const durationSeconds = Math.max(
      0,
      Math.round((new Date(checkedAtIso).getTime() - new Date(openIncident.started_at).getTime()) / 1000)
    );
    closeIncident.run(checkedAtIso, durationSeconds, openIncident.id);
    eventBus.emit('event', {
      type: 'incident_resolve',
      urlId,
      url,
      startedAt: openIncident.started_at,
      resolvedAt: checkedAtIso,
      durationSeconds,
    });
  }

  return { scheduleFastRecheck: regionResult.scheduleFastRecheck };
}
