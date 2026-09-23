const test = require('node:test');
const assert = require('node:assert/strict');

const { step, runSequence, specConfig } = require('./helpers/stateEngineHarness');

const at = (hhmm) => `2026-01-01T${hhmm}:00Z`;

for (const from of ['TRIGGERED', 'CRITICAL']) {
  test(`first ${from} -> NORMAL evidence does not send`, () => {
    const prior = { state: from, cooldown: null, recovery: { pending: false, evidence_count: 0 } };
    const decision = step(prior, 5, { at: at('10:00') });
    assert.equal(decision.resulting_state, 'NORMAL');
    assert.equal(decision.notification.should_send, false);
    assert.equal(decision.notification.candidate_reason, null);
    assert.equal(decision.recovery.pending, true);
    assert.equal(decision.recovery.evidence_count, 1);
    assert.equal(decision.recovery.from_state, from);
  });
}

test('the second automatic NORMAL run sends RECOVERY and clears recovery and cooldown', () => {
  const [, , first, second] = runSequence([
    { value: 17, at: at('09:00') },
    { value: 28, at: at('09:10') },
    { value: 5, at: at('09:20') },
    { value: 5, at: at('09:30') }
  ]);
  assert.equal(first.notification.should_send, false);
  assert.equal(second.notification.reason, 'RECOVERY');
  assert.equal(second.recovery.from_state, 'CRITICAL');
  assert.deepEqual(second.next.recovery, { pending: false, evidence_count: 0, from_state: null, required_evidence: 2 });
  assert.equal(second.next.cooldown, null);
  assert.equal(second.next.last_alert_at, new Date(at('09:30')).toISOString());
});

test('a manual T -> NORMAL starts recovery with zero evidence', () => {
  const [, manual] = runSequence([
    { value: 17, at: at('09:00') },
    { value: 5, at: at('09:10'), triggerType: 'manual' }
  ]);
  assert.equal(manual.next.state, 'NORMAL');
  assert.equal(manual.recovery.pending, true);
  assert.equal(manual.recovery.evidence_count, 0);
});

test('a manual NORMAL while recovery is pending does not increment evidence or send', () => {
  const decisions = runSequence([
    { value: 17, at: at('09:00') },
    { value: 5, at: at('09:10') }, // evidence 1
    { value: 5, at: at('09:20'), triggerType: 'manual' }, // still 1
    { value: 5, at: at('09:30') } // evidence 2 -> RECOVERY
  ]);
  assert.equal(decisions[2].recovery.evidence_count, 1);
  assert.equal(decisions[2].notification.should_send, false);
  assert.equal(decisions[3].notification.reason, 'RECOVERY');
});

test('after a manual T -> NORMAL, two automatic NORMAL runs are still required', () => {
  const decisions = runSequence([
    { value: 17, at: at('09:00') },
    { value: 5, at: at('09:10'), triggerType: 'manual' }, // 0
    { value: 5, at: at('09:20') }, // 1
    { value: 5, at: at('09:30') } // 2 -> RECOVERY
  ]);
  assert.equal(decisions[2].recovery.evidence_count, 1);
  assert.equal(decisions[2].notification.should_send, false);
  assert.equal(decisions[3].notification.reason, 'RECOVERY');
});

test('a manual run never sends RECOVERY, even when evidence is already complete', () => {
  const config = specConfig({ quiet_hours: { enabled: true, start: '23:00', end: '07:00' } });
  const decisions = runSequence([
    { value: 17, at: '2026-01-01T22:00:00Z' },
    { value: 5, at: '2026-01-01T23:10:00Z' }, // evidence 1
    { value: 5, at: '2026-01-01T23:20:00Z' }, // evidence 2, quiet -> held pending
    { value: 5, at: '2026-01-02T08:00:00Z', triggerType: 'manual' }
  ], { config });
  assert.equal(decisions[2].notification.suppressed_by, 'quiet_hours');
  assert.equal(decisions[3].notification.should_send, false);
  assert.equal(decisions[3].recovery.pending, true);
});

for (const [label, value] of [['TRIGGERED', 17], ['CRITICAL', 28]]) {
  for (const triggerType of ['cron', 'manual']) {
    test(`evidence resets when a ${triggerType} run resolves to ${label}`, () => {
      const decisions = runSequence([
        { value: 28, at: at('09:00') },
        { value: 5, at: at('09:10') },
        { value, at: at('09:20'), triggerType }
      ]);
      assert.equal(decisions[1].recovery.evidence_count, 1);
      assert.equal(decisions[2].recovery.pending, false);
      assert.equal(decisions[2].recovery.evidence_count, 0);
      assert.equal(decisions[2].next.state, label);
    });
  }
}

test('NORMAL -> NORMAL without recovery_pending never sends', () => {
  const runs = Array.from({ length: 10 }, (_, i) => ({ value: 3, at: `2026-01-01T${String(10 + i).padStart(2, '0')}:00:00Z` }));
  for (const decision of runSequence(runs)) {
    assert.equal(decision.notification.should_send, false);
    assert.equal(decision.notification.candidate_reason, null);
    assert.equal(decision.recovery.pending, false);
  }
});

test('a recovery due during quiet hours stays pending and sends on the next automatic run outside them', () => {
  const config = specConfig({ quiet_hours: { enabled: true, start: '23:00', end: '07:00' } });
  const decisions = runSequence([
    { value: 17, at: '2026-01-01T22:00:00Z' },
    { value: 5, at: '2026-01-01T23:30:00Z' },
    { value: 5, at: '2026-01-02T01:00:00Z' },
    { value: 5, at: '2026-01-02T08:00:00Z' }
  ], { config });
  assert.equal(decisions[2].notification.candidate_reason, 'RECOVERY');
  assert.equal(decisions[2].notification.suppressed_by, 'quiet_hours');
  assert.equal(decisions[2].recovery.pending, true);
  assert.equal(decisions[3].notification.reason, 'RECOVERY');
});

test('after a sent RECOVERY, a new incident gets INITIAL_TRIGGER even inside the old cooldown', () => {
  const decisions = runSequence([
    { value: 17, at: at('09:00') }, // INITIAL_TRIGGER, 60m cooldown from 09:00
    { value: 5, at: at('09:05') },
    { value: 5, at: at('09:10') }, // RECOVERY clears cooldown
    { value: 17, at: at('09:15') }
  ]);
  assert.equal(decisions[2].notification.reason, 'RECOVERY');
  assert.equal(decisions[3].notification.reason, 'INITIAL_TRIGGER');
  assert.equal(decisions[3].notification.should_send, true);
});

test('required_evidence below 2 is raised to 2', () => {
  const config = specConfig({ recovery: { required_evidence: 1 } });
  assert.equal(config.recovery.required_evidence, 2);
  const [, first] = runSequence([{ value: 17, at: at('09:00') }, { value: 5, at: at('09:10') }], { config });
  assert.equal(first.notification.should_send, false);
});

test('a larger required_evidence waits for that many automatic NORMAL runs', () => {
  const config = specConfig({ recovery: { required_evidence: 3 } });
  const decisions = runSequence([
    { value: 17, at: at('09:00') },
    { value: 5, at: at('09:10') },
    { value: 5, at: at('09:20') },
    { value: 5, at: at('09:30') }
  ], { config });
  assert.equal(decisions[2].notification.should_send, false);
  assert.equal(decisions[3].notification.reason, 'RECOVERY');
});
