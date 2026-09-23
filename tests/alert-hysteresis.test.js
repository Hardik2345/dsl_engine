const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTransition } = require('../server/lib/alertTransition');

test('a threshold-hovering series produces one open/close cycle, not four', () => {
  // A metric bouncing right at the threshold: breach, clean, breach, clean, breach,
  // breach, clean, clean. With for_observations=2 and clear_after_observations=2
  // (the cron defaults), this should open exactly once and resolve exactly once --
  // not the new/resolved/new/resolved flapping a naive single-observation engine
  // would produce.
  const breachingSequence = [true, false, true, false, true, true, false, false];

  let state = null;
  const transitions = [];

  breachingSequence.forEach((breaching, index) => {
    const result = computeTransition(state, {
      runStatus: 'completed',
      breaching,
      magnitude: breaching ? -20 : -2,
      triggerType: 'cron',
      observationKey: `obs-${index}`,
      observedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      policy: {},
    });
    state = result.nextState;
    transitions.push(result.transition);
  });

  const opens = transitions.filter((t) => t === 'new' || t === 'recurrence');
  const resolves = transitions.filter((t) => t === 'resolved');
  assert.equal(opens.length, 1);
  assert.equal(resolves.length, 1);
});

test('a single blip does not open a cron finding at all', () => {
  const result = computeTransition(null, {
    runStatus: 'completed',
    breaching: true,
    magnitude: -20,
    triggerType: 'cron',
    observationKey: 'obs-1',
    observedAt: '2026-01-01T00:00:00.000Z',
    policy: {},
  });
  const backToNormal = computeTransition(result.nextState, {
    runStatus: 'completed',
    breaching: false,
    magnitude: -2,
    triggerType: 'cron',
    observationKey: 'obs-2',
    observedAt: '2026-01-02T00:00:00.000Z',
    policy: {},
  });
  assert.equal(result.transition, 'none');
  assert.equal(backToNormal.transition, 'none');
  assert.equal(backToNormal.nextState.status, 'absent');
});
