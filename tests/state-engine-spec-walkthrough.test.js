const test = require('node:test');
const assert = require('node:assert/strict');

const { runSequence, step, specConfig } = require('./helpers/stateEngineHarness');

const quietConfig = specConfig({ quiet_hours: { enabled: true, start: '23:00', end: '07:00' } });

test('spec §30: runs 1-6 of workflow W', () => {
  const [run1, run2, run3, run4, run5, run6] = runSequence([
    { value: 17, at: '2026-01-01T10:00:00Z' },
    { value: 20, at: '2026-01-01T10:10:00Z' },
    { value: 28, at: '2026-01-01T10:20:00Z' },
    { value: 18, at: '2026-01-01T10:30:00Z' },
    { value: 8, at: '2026-01-01T10:40:00Z' },
    { value: 5, at: '2026-01-01T10:50:00Z' }
  ], { config: quietConfig });

  // Run 1: NORMAL -> TRIGGERED, INITIAL_TRIGGER, TRIGGERED cooldown starts.
  assert.equal(run1.next.state, 'TRIGGERED');
  assert.equal(run1.notification.reason, 'INITIAL_TRIGGER');
  assert.deepEqual(run1.next.cooldown, { state: 'TRIGGERED', duration_minutes: 60, started_at: '2026-01-01T10:00:00.000Z' });

  // Run 2: TRIGGERED -> TRIGGERED inside the cooldown, silent.
  assert.equal(run2.next.state, 'TRIGGERED');
  assert.equal(run2.notification.should_send, false);
  assert.equal(run2.notification.suppressed_by, 'cooldown');

  // Run 3: TRIGGERED -> CRITICAL escalates through the active cooldown.
  assert.equal(run3.next.state, 'CRITICAL');
  assert.equal(run3.notification.reason, 'ESCALATION');
  assert.equal(run3.cooldown.bypassed, true);
  assert.deepEqual(run3.next.cooldown, { state: 'CRITICAL', duration_minutes: 30, started_at: '2026-01-01T10:20:00.000Z' });

  // Run 4: CRITICAL -> TRIGGERED is not a recovery; TRIGGERED cooldown applies.
  assert.equal(run4.next.state, 'TRIGGERED');
  assert.equal(run4.notification.candidate_reason, 'DE_ESCALATION');
  assert.equal(run4.notification.suppressed_by, 'cooldown');
  assert.equal(run4.recovery.pending, false);

  // Run 5: TRIGGERED -> NORMAL, evidence 1, no mail.
  assert.equal(run5.next.state, 'NORMAL');
  assert.equal(run5.notification.should_send, false);
  assert.equal(run5.recovery.pending, true);
  assert.equal(run5.recovery.evidence_count, 1);

  // Run 6: NORMAL -> NORMAL, evidence 2, RECOVERY.
  assert.equal(run6.notification.reason, 'RECOVERY');
  assert.equal(run6.next.recovery.pending, false);
  assert.equal(run6.next.recovery.evidence_count, 0);
});

test('spec §31: a failed recovery cancels without a notification', () => {
  const [, first, relapse] = runSequence([
    { value: 28, at: '2026-01-01T10:00:00Z' },
    { value: 5, at: '2026-01-01T10:10:00Z' },
    { value: 17, at: '2026-01-01T10:20:00Z' }
  ]);
  assert.equal(first.recovery.evidence_count, 1);
  assert.equal(relapse.next.state, 'TRIGGERED');
  assert.equal(relapse.recovery.pending, false);
  assert.equal(relapse.recovery.evidence_count, 0);
  assert.notEqual(relapse.notification.reason, 'RECOVERY');
});

test('spec §32: quiet hours hold N->T and T->C but not a direct N->C', () => {
  const [enter, escalate] = runSequence([
    { value: 17, at: '2026-01-01T23:30:00Z' },
    { value: 28, at: '2026-01-02T01:00:00Z' }
  ], { config: quietConfig });
  assert.equal(enter.next.state, 'TRIGGERED');
  assert.equal(enter.notification.should_send, false);
  assert.equal(enter.notification.suppressed_by, 'quiet_hours');
  assert.equal(escalate.next.state, 'CRITICAL');
  assert.equal(escalate.notification.should_send, false);
  assert.equal(escalate.notification.suppressed_by, 'quiet_hours');

  const direct = step(null, 28, { at: '2026-01-02T01:00:00Z', config: quietConfig });
  assert.equal(direct.notification.reason, 'ESCALATION');
  assert.equal(direct.quiet_hours.bypassed, true);
});

test('spec §17: same-state reminders and recoveries are held during quiet hours', () => {
  const prior = { state: 'TRIGGERED', cooldown: { state: 'TRIGGERED', duration_minutes: 60, started_at: '2026-01-01T12:00:00Z' } };
  const reminder = step(prior, 17, { at: '2026-01-02T02:00:00Z', config: quietConfig });
  assert.equal(reminder.notification.candidate_reason, 'REMINDER');
  assert.equal(reminder.notification.suppressed_by, 'quiet_hours');
});

test('spec §19: cooldown pauses through quiet hours and resumes after', () => {
  const prior = { state: 'TRIGGERED', cooldown: { state: 'TRIGGERED', duration_minutes: 60, started_at: '2026-01-01T22:50:00Z' } };
  // 07:30 the next morning: only 10 + 29 = 39 active minutes have passed.
  const early = step(prior, 17, { at: '2026-01-02T07:30:00Z', config: quietConfig });
  assert.equal(early.notification.suppressed_by, 'cooldown');
  // 07:51: 10 + 50 = 60 active minutes, cooldown over.
  const due = step(prior, 17, { at: '2026-01-02T07:51:00Z', config: quietConfig });
  assert.equal(due.notification.reason, 'REMINDER');
});

test('spec §20: nothing held during quiet hours is released without a new run', () => {
  const prior = { state: 'TRIGGERED', cooldown: { state: 'TRIGGERED', duration_minutes: 60, started_at: '2026-01-01T12:00:00Z' } };
  const held = step(prior, 17, { at: '2026-01-02T02:00:00Z', config: quietConfig });
  assert.equal(held.notification.should_send, false);
  // The held run leaves the cooldown untouched, so the next real run evaluates on
  // its own merits -- there is no queued notification to flush.
  assert.deepEqual(held.next.cooldown, prior.cooldown);
  const nextRun = step(held.next, 17, { at: '2026-01-02T08:00:00Z', config: quietConfig });
  assert.equal(nextRun.notification.reason, 'REMINDER');
});
