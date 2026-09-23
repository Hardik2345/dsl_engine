const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTransition } = require('../server/lib/alertTransition');

function baseObservation(overrides = {}) {
  return {
    runStatus: 'completed',
    breaching: true,
    magnitude: -20,
    triggerType: 'event',
    observationKey: 'obs-1',
    observedAt: '2026-01-01T00:00:00.000Z',
    policy: {},
    ...overrides,
  };
}

test('a terminated run never resolves an open finding', () => {
  const opened = computeTransition(null, baseObservation());
  const terminated = computeTransition(opened.nextState, baseObservation({
    runStatus: 'terminated', observationKey: 'obs-2', observedAt: '2026-01-02T00:00:00.000Z'
  }));
  assert.equal(terminated.transition, 'inconclusive');
  assert.equal(terminated.notify, false);
  assert.equal(terminated.nextState.status, 'active');
  assert.equal(terminated.nextState.consecutiveClean, 0);
});

test('a failed run never opens a new finding', () => {
  const failed = computeTransition(null, baseObservation({ runStatus: 'failed' }));
  assert.equal(failed.transition, 'inconclusive');
  assert.equal(failed.notify, false);
  assert.equal(failed.nextState.status, 'absent');
});

test('a dead-lettered run is inconclusive, same as failed', () => {
  const result = computeTransition(null, baseObservation({ runStatus: 'dead_letter' }));
  assert.equal(result.transition, 'inconclusive');
});

test('consecutiveBreach and consecutiveClean are untouched by inconclusive observations', () => {
  const opened = computeTransition(null, baseObservation({ triggerType: 'cron' }));
  assert.equal(opened.nextState.consecutiveBreach, 1);

  const inconclusive = computeTransition(opened.nextState, baseObservation({
    runStatus: 'terminated', triggerType: 'cron', observationKey: 'obs-2', observedAt: '2026-01-02T00:00:00.000Z'
  }));
  assert.equal(inconclusive.nextState.consecutiveBreach, 1);
  assert.equal(inconclusive.nextState.consecutiveClean, 0);
});

test('inconclusiveStreak accumulates across consecutive inconclusive observations', () => {
  let state = null;
  for (let i = 0; i < 3; i += 1) {
    const result = computeTransition(state, baseObservation({
      runStatus: 'terminated', observationKey: `obs-${i}`, observedAt: `2026-01-0${i + 1}T00:00:00.000Z`
    }));
    state = result.nextState;
  }
  assert.equal(state.inconclusiveStreak, 3);
});

test('a conclusive observation after an inconclusive one resets inconclusiveStreak', () => {
  const inconclusive = computeTransition(null, baseObservation({ runStatus: 'terminated' }));
  assert.equal(inconclusive.nextState.inconclusiveStreak, 1);

  const conclusive = computeTransition(inconclusive.nextState, baseObservation({
    observationKey: 'obs-2', observedAt: '2026-01-02T00:00:00.000Z'
  }));
  assert.equal(conclusive.nextState.inconclusiveStreak, 0);
});
