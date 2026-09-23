// Shared helpers for the state-engine tests: a spec-§30-shaped config and a
// `runSequence` that feeds each decision's `next` back in as the following prior,
// mirroring what stateEngineService persists between executions.
const { normalizeStateConfig } = require('../../server/lib/stateEngine/defaults');
const { evaluateState } = require('../../server/lib/stateEngine/evaluateState');

function specConfig(overrides = {}) {
  return normalizeStateConfig({
    enabled: true,
    finding: { metric: 'cvr_delta_pct', direction: 'drop' },
    thresholds: { normal: 15, critical: 25 },
    cooldown: { triggered_minutes: 60, critical_minutes: 30 },
    recovery: { required_evidence: 2 },
    quiet_hours: { enabled: false, start: '23:00', end: '07:00' },
    ...overrides
  });
}

// value is the already-normalized drop magnitude (17 means CVR fell 17%).
function finding(value) {
  return { metric: 'cvr_delta_pct', raw: -value, value, direction: 'drop', conclusive: true };
}

function step(prior, value, { at, triggerType = 'cron', config = specConfig(), timezone = 'UTC' } = {}) {
  return evaluateState({ prior, finding: finding(value), triggerType, now: new Date(at), config, timezone });
}

// runs: [{ value, at, triggerType? }]; returns every decision in order.
function runSequence(runs, { config = specConfig(), timezone = 'UTC', prior = null } = {}) {
  const decisions = [];
  let current = prior;
  for (const run of runs) {
    const decision = step(current, run.value, { at: run.at, triggerType: run.triggerType, config, timezone });
    decisions.push(decision);
    current = decision.next;
  }
  return decisions;
}

module.exports = { specConfig, finding, step, runSequence };
