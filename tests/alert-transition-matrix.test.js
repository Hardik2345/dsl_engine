const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTransition } = require('../server/lib/alertTransition');

function observation(overrides = {}) {
  return {
    runStatus: 'completed',
    breaching: true,
    magnitude: -20,
    triggerType: 'event',
    observationKey: 'obs-1',
    observedAt: '2026-01-05T00:00:00.000Z',
    policy: {},
    ...overrides,
  };
}

test('absent -> new: a single breach opens a finding for an event-triggered workflow (for_observations default 1)', () => {
  const { transition, notify, nextState } = computeTransition(null, observation());
  assert.equal(transition, 'new');
  assert.equal(notify, true);
  assert.equal(nextState.status, 'active');
  assert.equal(nextState.episodeCount, 1);
});

test('absent -> absent: a single breach does not open a finding for a cron workflow (for_observations default 2)', () => {
  const first = computeTransition(null, observation({ triggerType: 'cron' }));
  assert.equal(first.transition, 'none');
  assert.equal(first.notify, false);
  assert.equal(first.nextState.status, 'absent');
  assert.equal(first.nextState.consecutiveBreach, 1);
});

test('absent -> new: a second consecutive breach opens the cron finding', () => {
  const first = computeTransition(null, observation({ triggerType: 'cron', observationKey: 'obs-1' }));
  const second = computeTransition(first.nextState, observation({ triggerType: 'cron', observationKey: 'obs-2' }));
  assert.equal(second.transition, 'new');
  assert.equal(second.notify, true);
});

test('absent -> new bypasses for_observations when the first reading is already critical', () => {
  const { transition, notify, criticalBypass } = computeTransition(
    null,
    observation({ triggerType: 'cron', severityTier: 'critical' })
  );
  assert.equal(transition, 'new');
  assert.equal(notify, true);
  assert.equal(criticalBypass, true);
});

test('active -> active: a small change stays within the significance band and is suppressed', () => {
  const opened = computeTransition(null, observation({ magnitude: -20 }));
  const nextReading = computeTransition(opened.nextState, observation({ magnitude: -22, observationKey: 'obs-2' }));
  assert.equal(nextReading.transition, 'none');
  assert.equal(nextReading.notify, false);
});

test('active -> active: a single reading crossing significance.delta_pct escalates immediately, no second observation needed', () => {
  const opened = computeTransition(null, observation({ magnitude: -20 }));
  const worsened = computeTransition(opened.nextState, observation({ magnitude: -41, observationKey: 'obs-2' }));
  assert.equal(worsened.transition, 'escalation');
  assert.equal(worsened.notify, true);
});

test('active -> active: crossing into critical severity for the first time escalates and marks a critical bypass', () => {
  const opened = computeTransition(null, observation({ magnitude: -20, severityTier: 'warning' }));
  const critical = computeTransition(
    opened.nextState,
    observation({ magnitude: -20.1, severityTier: 'critical', observationKey: 'obs-2' })
  );
  assert.equal(critical.transition, 'escalation');
  assert.equal(critical.criticalBypass, true);
});

test('active -> active: a second critical reading in the same episode is not re-flagged as a bypass', () => {
  const opened = computeTransition(null, observation({ magnitude: -50, severityTier: 'critical' }));
  const stillCritical = computeTransition(
    opened.nextState,
    observation({ magnitude: -51, severityTier: 'critical', observationKey: 'obs-2' })
  );
  assert.equal(stillCritical.criticalBypass, false);
});

test('active -> resolved: two consecutive clean readings resolve the finding', () => {
  const opened = computeTransition(null, observation());
  const recovering = computeTransition(opened.nextState, observation({ breaching: false, observationKey: 'obs-2' }));
  assert.equal(recovering.transition, 'none');
  assert.equal(recovering.nextState.status, 'recovering');
  const resolved = computeTransition(recovering.nextState, observation({ breaching: false, observationKey: 'obs-3' }));
  assert.equal(resolved.transition, 'resolved');
  assert.equal(resolved.notify, true);
});

test('resolved -> recurrence within the recurrence window', () => {
  const opened = computeTransition(null, observation({ observedAt: '2026-01-01T00:00:00.000Z' }));
  const c1 = computeTransition(opened.nextState, observation({ breaching: false, observationKey: 'c1', observedAt: '2026-01-02T00:00:00.000Z' }));
  const resolved = computeTransition(c1.nextState, observation({ breaching: false, observationKey: 'c2', observedAt: '2026-01-03T00:00:00.000Z' }));
  assert.equal(resolved.transition, 'resolved');

  const reoccurred = computeTransition(
    resolved.nextState,
    observation({ observationKey: 'r1', observedAt: '2026-01-05T00:00:00.000Z' })
  );
  assert.equal(reoccurred.transition, 'recurrence');
  assert.equal(reoccurred.nextState.episodeCount, 2);
});

test('resolved -> new outside the recurrence window, treated as an unrelated fresh occurrence', () => {
  const opened = computeTransition(null, observation({ observedAt: '2026-01-01T00:00:00.000Z' }));
  const c1 = computeTransition(opened.nextState, observation({ breaching: false, observationKey: 'c1', observedAt: '2026-01-02T00:00:00.000Z' }));
  const resolved = computeTransition(c1.nextState, observation({ breaching: false, observationKey: 'c2', observedAt: '2026-01-03T00:00:00.000Z' }));

  const monthLater = computeTransition(
    resolved.nextState,
    observation({ observationKey: 'r1', observedAt: '2026-02-15T00:00:00.000Z' })
  );
  assert.equal(monthLater.transition, 'new');
  assert.equal(monthLater.nextState.episodeCount, 1);
});

test('flap: repeated opens within the window increment flapCount without resetting the window start', () => {
  let state = null;

  const open1 = computeTransition(state, observation({ observationKey: 'o1', observedAt: '2026-01-01T00:00:00.000Z' }));
  assert.equal(open1.nextState.flapCount, 1);
  assert.equal(open1.nextState.flapWindowStartedAt, '2026-01-01T00:00:00.000Z');
  state = open1.nextState;

  const clean1 = computeTransition(state, observation({ breaching: false, observationKey: 'c1', observedAt: '2026-01-01T01:00:00.000Z' }));
  const resolved1 = computeTransition(clean1.nextState, observation({ breaching: false, observationKey: 'c2', observedAt: '2026-01-01T02:00:00.000Z' }));
  assert.equal(resolved1.transition, 'resolved');
  // Resolving must not touch flap bookkeeping -- flap decays only by window expiry.
  assert.equal(resolved1.nextState.flapCount, 1);
  assert.equal(resolved1.nextState.flapWindowStartedAt, '2026-01-01T00:00:00.000Z');
  state = resolved1.nextState;

  // Reopens 3h later -- well within the 72h default flap window.
  const open2 = computeTransition(state, observation({ observationKey: 'o2', observedAt: '2026-01-01T05:00:00.000Z' }));
  assert.equal(open2.nextState.flapCount, 2);
  assert.equal(open2.nextState.flapWindowStartedAt, '2026-01-01T00:00:00.000Z');
});

test('flap: a reopen after the window has fully elapsed resets the count to 1', () => {
  const open1 = computeTransition(null, observation({ observationKey: 'o1', observedAt: '2026-01-01T00:00:00.000Z' }));

  // 100 hours later -- past the 72h default flap window.
  const open2 = computeTransition(
    { ...open1.nextState, status: 'resolved', resolvedAt: '2026-01-01T01:00:00.000Z' },
    observation({ observationKey: 'o2', observedAt: '2026-01-05T04:00:00.000Z' })
  );
  assert.equal(open2.nextState.flapCount, 1);
  assert.equal(open2.nextState.flapWindowStartedAt, '2026-01-05T04:00:00.000Z');
});

test('flap: policy.flap.window_ms overrides the default window', () => {
  const open1 = computeTransition(null, observation({ observationKey: 'o1', observedAt: '2026-01-01T00:00:00.000Z' }));
  const resolved = computeTransition(
    open1.nextState,
    observation({ breaching: false, observationKey: 'c1', observedAt: '2026-01-01T00:30:00.000Z', policy: { clear_after_observations: 1 } })
  );

  // A 1-hour-later reopen is inside a 30-minute custom window's expiry, so it
  // should NOT count as within the window -- flapCount resets to 1.
  const open2 = computeTransition(
    resolved.nextState,
    observation({ observationKey: 'o2', observedAt: '2026-01-01T01:00:00.000Z', policy: { flap: { window_ms: 30 * 60 * 1000 } } })
  );
  assert.equal(open2.nextState.flapCount, 1);
});

test('tier ladder: escalation fires on any upward severity crossing, not just into "critical"', () => {
  const opened = computeTransition(null, observation({ magnitude: -20, severityTier: 'warning' }));
  assert.equal(opened.nextState.currentEpisode.peakSeverityTier, 'warning');

  const toCritical = computeTransition(
    opened.nextState,
    observation({ magnitude: -20.1, severityTier: 'critical', observationKey: 'obs-2' })
  );
  assert.equal(toCritical.transition, 'escalation');

  const toPaging = computeTransition(
    toCritical.nextState,
    observation({ magnitude: -20.2, severityTier: 'paging', observationKey: 'obs-3' })
  );
  assert.equal(toPaging.transition, 'escalation');
  assert.equal(toPaging.nextState.currentEpisode.peakSeverityTier, 'paging');
});

test('tier ladder: repeating the same tier with an insignificant magnitude change does not escalate again', () => {
  const opened = computeTransition(null, observation({ magnitude: -20, severityTier: 'paging' }));
  const again = computeTransition(
    opened.nextState,
    observation({ magnitude: -20.1, severityTier: 'paging', observationKey: 'obs-2' })
  );
  assert.equal(again.transition, 'none');
});

test('tier ladder: a custom severity_tier_order is honored', () => {
  const opened = computeTransition(null, observation({
    magnitude: -20, severityTier: 'minor', policy: { severity_tier_order: ['minor', 'major'] }
  }));
  const escalated = computeTransition(
    opened.nextState,
    observation({
      magnitude: -20.1, severityTier: 'major', observationKey: 'obs-2',
      policy: { severity_tier_order: ['minor', 'major'] }
    })
  );
  assert.equal(escalated.transition, 'escalation');
});

test('tier ladder: workflows with no severity_tiers declared are unaffected (severityTier always null)', () => {
  const opened = computeTransition(null, observation({ magnitude: -20, severityTier: null }));
  const stillNull = computeTransition(
    opened.nextState,
    observation({ magnitude: -20.1, severityTier: null, observationKey: 'obs-2' })
  );
  assert.equal(stillNull.transition, 'none');
});
