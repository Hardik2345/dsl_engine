const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateSuppression } = require('../server/lib/suppressionPipeline');

function baseCandidate(overrides = {}) {
  return {
    transition: 'new',
    conclusive: true,
    dryRun: false,
    criticalBypass: false,
    humanState: {},
    flapDemoted: false,
    cooldownOk: true,
    isSignificant: true,
    quietHours: null,
    timezone: 'UTC',
    now: new Date('2026-01-01T12:00:00.000Z'),
    burstCap: null,
    burstRank: null,
    rateCap: null,
    rateUsed: null,
    contentHash: null,
    priorContentHash: null,
    ...overrides,
  };
}

test('step 1: a dry run is always suppressed regardless of everything else', () => {
  const result = evaluateSuppression(baseCandidate({ dryRun: true, criticalBypass: true }));
  assert.deepEqual(result, { action: 'suppress', reason: 'dry_run' });
});

test('step 2: an inconclusive observation is suppressed', () => {
  const result = evaluateSuppression(baseCandidate({ conclusive: false }));
  assert.equal(result.action, 'suppress');
  assert.equal(result.reason, 'inconclusive');
});

test('step 4: a transition of "none" has nothing to notify', () => {
  const result = evaluateSuppression(baseCandidate({ transition: 'none' }));
  assert.equal(result.reason, 'no_transition');
});

test('step 5: a muted finding is suppressed even when the reading is a critical bypass candidate', () => {
  const result = evaluateSuppression(baseCandidate({ criticalBypass: true, humanState: { muted: true } }));
  assert.equal(result.action, 'suppress');
  assert.equal(result.reason, 'muted');
});

test('step 5: a snoozed finding is held until snoozedUntil, not suppressed outright', () => {
  const result = evaluateSuppression(baseCandidate({
    humanState: { snoozed: { until: '2026-01-02T00:00:00.000Z' } }
  }));
  assert.equal(result.action, 'hold');
  assert.equal(result.reason, 'snoozed');
  assert.equal(result.heldUntil, '2026-01-02T00:00:00.000Z');
});

test('step 5: an acked finding suppresses a reminder but allows an escalation through', () => {
  const reminder = evaluateSuppression(baseCandidate({ transition: 'new', humanState: { acked: true } }));
  assert.equal(reminder.action, 'suppress');
  assert.equal(reminder.reason, 'acked');

  const escalation = evaluateSuppression(baseCandidate({ transition: 'escalation', humanState: { acked: true } }));
  assert.equal(escalation.action, 'send');
});

test('step 6: flap-demoted findings route to digest instead of an immediate send', () => {
  const result = evaluateSuppression(baseCandidate({ flapDemoted: true }));
  assert.equal(result.action, 'digest');
  assert.equal(result.reason, 'flapping_digest');
});

test('step 6: the critical bypass skips flap demotion', () => {
  const result = evaluateSuppression(baseCandidate({ flapDemoted: true, criticalBypass: true }));
  assert.equal(result.action, 'send');
});

test('step 7: an active cooldown suppresses the send', () => {
  const result = evaluateSuppression(baseCandidate({ cooldownOk: false }));
  assert.equal(result.action, 'suppress');
  assert.equal(result.reason, 'cooldown');
});

test('step 7: the critical bypass skips cooldown', () => {
  const result = evaluateSuppression(baseCandidate({ cooldownOk: false, criticalBypass: true }));
  assert.equal(result.action, 'send');
});

test('step 8: an escalation whose change is not significant is suppressed', () => {
  const result = evaluateSuppression(baseCandidate({ transition: 'escalation', isSignificant: false }));
  assert.equal(result.action, 'suppress');
  assert.equal(result.reason, 'not_significant');
});

test('step 9: quiet hours hold a non-critical send until the window opens', () => {
  const result = evaluateSuppression(baseCandidate({
    quietHours: { start: '22:00', end: '07:00' },
    now: new Date('2026-01-01T23:00:00.000Z'),
  }));
  assert.equal(result.action, 'hold');
  assert.equal(result.reason, 'quiet_hours');
});

test('step 9: the critical bypass skips quiet hours', () => {
  const result = evaluateSuppression(baseCandidate({
    quietHours: { start: '22:00', end: '07:00' },
    now: new Date('2026-01-01T23:00:00.000Z'),
    criticalBypass: true,
  }));
  assert.equal(result.action, 'send');
});

test('step 10: a candidate beyond the burst cap rolls into a digest', () => {
  const result = evaluateSuppression(baseCandidate({ burstCap: 5, burstRank: 5 }));
  assert.equal(result.action, 'digest');
  assert.equal(result.reason, 'burst_cap');
});

test('step 10: the burst cap still applies to a critical bypass candidate', () => {
  const result = evaluateSuppression(baseCandidate({ burstCap: 5, burstRank: 5, criticalBypass: true }));
  assert.equal(result.action, 'digest');
  assert.equal(result.reason, 'burst_cap');
});

test('step 11: exceeding the per-recipient rate cap rolls into a digest', () => {
  const result = evaluateSuppression(baseCandidate({ rateCap: 40, rateUsed: 40 }));
  assert.equal(result.action, 'digest');
  assert.equal(result.reason, 'rate_cap');
});

test('step 12: identical content for the same finding is suppressed as a duplicate', () => {
  const result = evaluateSuppression(baseCandidate({ contentHash: 'abc', priorContentHash: 'abc' }));
  assert.equal(result.action, 'suppress');
  assert.equal(result.reason, 'duplicate_content');
});

test('a fully clean candidate is sent', () => {
  const result = evaluateSuppression(baseCandidate());
  assert.deepEqual(result, { action: 'send', reason: null });
});
