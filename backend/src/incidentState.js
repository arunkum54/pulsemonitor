// Layer 1 — per region: a single checker shouldn't declare an outage off
// one slow/dropped request. Require this many consecutive failures from
// the SAME region before that region calls it "down".
export const FAILURE_THRESHOLD = 2;

// Layer 2 — across regions: even if one region is confirmed-down, that
// might be a regional network issue rather than the target actually being
// down. Require a strict majority of reporting regions to agree before
// opening a URL-level incident (see quorumDecision below).

/**
 * Per-region debounce. Pure — no DB, no I/O.
 * @param {{ consecutiveFailures: number, confirmedDown: boolean }} state
 * @param {boolean} isUp
 */
export function nextRegionState(state, isUp) {
  const consecutiveFailures = state.consecutiveFailures || 0;
  const confirmedDown = !!state.confirmedDown;

  if (isUp) {
    return { consecutiveFailures: 0, confirmedDown: false, scheduleFastRecheck: false };
  }

  const nextFailures = consecutiveFailures + 1;
  const nextConfirmedDown = confirmedDown || nextFailures >= FAILURE_THRESHOLD;

  return {
    consecutiveFailures: nextFailures,
    confirmedDown: nextConfirmedDown,
    // Only worth confirming fast the first time; once confirmed-down,
    // the region already knows and the regular check cadence is enough.
    scheduleFastRecheck: !confirmedDown && nextFailures === 1,
  };
}

/**
 * Cross-region quorum. Given each region's current per-region state for a
 * URL, decides the URL's overall confirmed status by strict majority. Pure
 * — no DB, no I/O.
 *
 * Deliberately has no minimum-region requirement: with only one region
 * reporting (a single-instance deployment — Render/Railway free tier,
 * `npm run dev`, etc.) this correctly degenerates to that region's own
 * confirmed state. With three regions, it correctly requires 2 of 3 to
 * agree before calling an outage. Same function, no special-casing needed.
 *
 * @param {Array<{ region: string, confirmedDown: boolean }>} regionStates
 * @returns {'up' | 'down' | 'pending'} 'pending' only when no region has
 *   ever reported for this URL yet (shouldn't happen in practice — the
 *   calling region's own state is always included).
 */
export function quorumDecision(regionStates) {
  if (regionStates.length === 0) return 'pending';

  const downCount = regionStates.filter((r) => r.confirmedDown).length;
  const upCount = regionStates.length - downCount;

  return downCount > upCount ? 'down' : 'up';
}
