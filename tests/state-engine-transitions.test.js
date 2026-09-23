const test = require('node:test');
const assert = require('node:assert/strict');

const { step, specConfig } = require('./helpers/stateEngineHarness');

const VALUE = { NORMAL: 5, TRIGGERED: 17, CRITICAL: 28 };
const T0 = '2026-01-01T10:00:00Z';
const T_LATER = '2026-01-01T13:00:00Z'; // past every cooldown in specConfig

function priorIn(state, { cooldownStartedAt = null } = {}) {
  return {
    state,
    cooldown: cooldownStartedAt ? { state, duration_minutes: 60, started_at: cooldownStartedAt } : null,
    recovery: { pending: false, evidence_count: 0 },
    last_alert_at: cooldownStartedAt
  };
}

// Spec §5 matrix, with no active cooldown, outside quiet hours, automatic trigger.
const matrix = [
  ['NORMAL', 'NORMAL', null],
  ['NORMAL', 'TRIGGERED', 'INITIAL_TRIGGER'],
  ['NORMAL', 'CRITICAL', 'ESCALATION'],
  ['TRIGGERED', 'NORMAL', null],
  ['TRIGGERED', 'TRIGGERED', 'REMINDER'],
  ['TRIGGERED', 'CRITICAL', 'ESCALATION'],
  ['CRITICAL', 'NORMAL', null],
  ['CRITICAL', 'TRIGGERED', 'DE_ESCALATION'],
  ['CRITICAL', 'CRITICAL', 'REMINDER']
];

for (const [from, to, reason] of matrix) {
  test(`${from} -> ${to} resolves to ${to} and ${reason || 'no notification'}`, () => {
    const decision = step(priorIn(from, { cooldownStartedAt: T0 }), VALUE[to], { at: T_LATER });
    assert.equal(decision.previous_state, from);
    assert.equal(decision.resulting_state, to);
    assert.equal(decision.next.state, to);
    assert.equal(decision.notification.reason, reason);
    assert.equal(decision.notification.should_send, Boolean(reason));
  });
}

test('an active cooldown suppresses the notification but never the state change', () => {
  const at = '2026-01-01T10:10:00Z'; // 10 minutes into a 60 minute cooldown
  const reminder = step(priorIn('TRIGGERED', { cooldownStartedAt: T0 }), VALUE.TRIGGERED, { at });
  assert.equal(reminder.next.state, 'TRIGGERED');
  assert.equal(reminder.notification.should_send, false);
  assert.equal(reminder.notification.suppressed_by, 'cooldown');
  assert.equal(reminder.cooldown.active, true);
  // cooldown is left as it was, not restarted
  assert.equal(reminder.next.cooldown.started_at, T0);
});

test('quiet hours suppress the notification but never the state change', () => {
  const config = specConfig({ quiet_hours: { enabled: true, start: '23:00', end: '07:00' } });
  const decision = step(priorIn('NORMAL'), VALUE.TRIGGERED, { at: '2026-01-01T23:30:00Z', config });
  assert.equal(decision.next.state, 'TRIGGERED');
  assert.equal(decision.notification.should_send, false);
  assert.equal(decision.notification.suppressed_by, 'quiet_hours');
  assert.equal(decision.next.cooldown, null);
});

test('TRIGGERED -> CRITICAL bypasses an active TRIGGERED cooldown and starts the CRITICAL one', () => {
  const at = '2026-01-01T10:10:00Z';
  const decision = step(priorIn('TRIGGERED', { cooldownStartedAt: T0 }), VALUE.CRITICAL, { at });
  assert.equal(decision.notification.reason, 'ESCALATION');
  assert.equal(decision.cooldown.bypassed, true);
  assert.deepEqual(decision.next.cooldown, { state: 'CRITICAL', duration_minutes: 30, started_at: new Date(at).toISOString() });
});

test('NORMAL -> TRIGGERED with a still-running cooldown (flap) is suppressed', () => {
  const prior = { ...priorIn('NORMAL'), cooldown: { state: 'TRIGGERED', duration_minutes: 60, started_at: T0 } };
  const decision = step(prior, VALUE.TRIGGERED, { at: '2026-01-01T10:20:00Z' });
  assert.equal(decision.next.state, 'TRIGGERED');
  assert.equal(decision.notification.candidate_reason, 'INITIAL_TRIGGER');
  assert.equal(decision.notification.suppressed_by, 'cooldown');
});

test('CRITICAL -> TRIGGERED is DE_ESCALATION gated by the TRIGGERED cooldown, not a recovery', () => {
  const prior = { ...priorIn('CRITICAL'), cooldown: { state: 'CRITICAL', duration_minutes: 30, started_at: T0 } };
  // 40 minutes: past the 30m CRITICAL cooldown, still inside the 60m TRIGGERED one.
  const decision = step(prior, VALUE.TRIGGERED, { at: '2026-01-01T10:40:00Z' });
  assert.equal(decision.notification.candidate_reason, 'DE_ESCALATION');
  assert.equal(decision.cooldown.applicable_state, 'TRIGGERED');
  assert.equal(decision.notification.suppressed_by, 'cooldown');
  assert.equal(decision.recovery.pending, false);
  assert.equal(decision.recovery.evidence_count, 0);
});

test('CRITICAL -> CRITICAL reminders use the CRITICAL cooldown', () => {
  const prior = { ...priorIn('CRITICAL'), cooldown: { state: 'CRITICAL', duration_minutes: 30, started_at: T0 } };
  assert.equal(step(prior, VALUE.CRITICAL, { at: '2026-01-01T10:29:00Z' }).notification.should_send, false);
  const due = step(prior, VALUE.CRITICAL, { at: '2026-01-01T10:30:00Z' });
  assert.equal(due.notification.reason, 'REMINDER');
  assert.equal(due.next.cooldown.started_at, '2026-01-01T10:30:00.000Z');
});

test('a first-ever evaluation with no prior starts from NORMAL', () => {
  const decision = step(null, VALUE.TRIGGERED, { at: T0 });
  assert.equal(decision.previous_state, 'NORMAL');
  assert.equal(decision.notification.reason, 'INITIAL_TRIGGER');
});
