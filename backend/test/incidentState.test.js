import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nextRegionState, quorumDecision, FAILURE_THRESHOLD } from '../src/incidentState.js';

describe('nextRegionState (per-region debounce)', () => {
  const healthy = { consecutiveFailures: 0, confirmedDown: false };

  test('a healthy check on an already-healthy region stays healthy', () => {
    const result = nextRegionState(healthy, true);
    assert.equal(result.consecutiveFailures, 0);
    assert.equal(result.confirmedDown, false);
    assert.equal(result.scheduleFastRecheck, false);
  });

  test('first failure does not confirm down yet, but schedules a fast recheck', () => {
    const result = nextRegionState(healthy, false);
    assert.equal(result.consecutiveFailures, 1);
    assert.equal(result.confirmedDown, false);
    assert.equal(result.scheduleFastRecheck, true);
  });

  test(`confirms down once ${FAILURE_THRESHOLD} consecutive failures are seen`, () => {
    const afterFirst = nextRegionState(healthy, false);
    const afterSecond = nextRegionState(
      { consecutiveFailures: afterFirst.consecutiveFailures, confirmedDown: afterFirst.confirmedDown },
      false
    );
    assert.equal(afterSecond.consecutiveFailures, FAILURE_THRESHOLD);
    assert.equal(afterSecond.confirmedDown, true);
  });

  test('does not re-schedule a fast recheck once already confirmed down', () => {
    const alreadyDown = { consecutiveFailures: 5, confirmedDown: true };
    const result = nextRegionState(alreadyDown, false);
    assert.equal(result.consecutiveFailures, 6);
    assert.equal(result.confirmedDown, true);
    assert.equal(result.scheduleFastRecheck, false);
  });

  test('a single healthy check immediately clears a confirmed-down region', () => {
    const down = { consecutiveFailures: 4, confirmedDown: true };
    const result = nextRegionState(down, true);
    assert.equal(result.consecutiveFailures, 0);
    assert.equal(result.confirmedDown, false);
  });
});

describe('quorumDecision (cross-region consensus)', () => {
  test('a single healthy region reads as up', () => {
    assert.equal(quorumDecision([{ region: 'us', confirmedDown: false }]), 'up');
  });

  test('a single confirmed-down region reads as down (single-instance deployment case)', () => {
    assert.equal(quorumDecision([{ region: 'us', confirmedDown: true }]), 'down');
  });

  test('1 of 3 regions down is not a majority — stays up', () => {
    const states = [
      { region: 'us', confirmedDown: true },
      { region: 'eu', confirmedDown: false },
      { region: 'ap', confirmedDown: false },
    ];
    assert.equal(quorumDecision(states), 'up');
  });

  test('2 of 3 regions down IS a majority — opens as down', () => {
    const states = [
      { region: 'us', confirmedDown: true },
      { region: 'eu', confirmedDown: true },
      { region: 'ap', confirmedDown: false },
    ];
    assert.equal(quorumDecision(states), 'down');
  });

  test('3 of 3 regions down — down', () => {
    const states = [
      { region: 'us', confirmedDown: true },
      { region: 'eu', confirmedDown: true },
      { region: 'ap', confirmedDown: true },
    ];
    assert.equal(quorumDecision(states), 'down');
  });

  test('no regions reported yet — pending, not a false "up"', () => {
    assert.equal(quorumDecision([]), 'pending');
  });

  test('a lone regional network blip does not fail the whole URL once a second region confirms healthy', () => {
    // This is the exact scenario quorum exists to prevent: one region's
    // own connectivity issue shouldn't read as the target being down.
    const states = [
      { region: 'us', confirmedDown: true },
      { region: 'eu', confirmedDown: false },
    ];
    assert.equal(quorumDecision(states), 'up');
  });
});
