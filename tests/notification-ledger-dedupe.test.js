const test = require('node:test');
const assert = require('node:assert/strict');

const { createSendEmail, runNotificationContext } = require('../server/services/emailService');

function createFakeLedger() {
  const rows = new Map();
  return {
    rows,
    async findRecentDuplicate({ tenantId, workflowId, contentHash }) {
      for (const row of rows.values()) {
        if (row.tenantId === tenantId && row.workflowId === workflowId
          && row.contentHash === contentHash && row.status === 'sent') {
          return row;
        }
      }
      return null;
    },
    async recordSuppressed(fields) {
      const key = `${fields.tenantId}|${fields.dedupeKey}`;
      rows.set(key, { ...fields, status: 'suppressed' });
    },
    async insertPending(fields) {
      const key = `${fields.tenantId}|${fields.dedupeKey}`;
      if (rows.has(key)) return { ok: false, reason: 'duplicate' };
      const row = { ...fields, status: 'pending' };
      rows.set(key, row);
      return { ok: true, row };
    },
    async finalize(row, delivery) {
      row.status = delivery.status === 'sent' ? 'sent' : 'failed';
      row.messageId = delivery.messageId;
    }
  };
}

test('a run retried after it already completed sends the identical email exactly once (via cooldown)', async () => {
  const ledger = createFakeLedger();
  let sendCount = 0;
  const rawSender = async () => {
    sendCount += 1;
    return { status: 'sent', provider: 'smtp', messageId: `msg-${sendCount}` };
  };
  const sendEmail = createSendEmail({ ledger, rawSender });

  const payload = { to: ['ops@example.com'], subject: 'Daily report', html: '<p>hi</p>' };
  const runCtx = { tenantId: 'tenant-1', workflowId: 'wf-1', runId: 'run-1' };

  // First attempt completes fully (its ledger row reaches 'sent') before the worker
  // decides, for an unrelated reason, to retry the same run from node one.
  const first = await runNotificationContext(runCtx, () => sendEmail(payload));
  const secondAttempt = await runNotificationContext(runCtx, () => sendEmail(payload));

  assert.equal(first.status, 'sent');
  // Caught by the cooldown check (a prior 'sent' row with identical content already
  // exists) rather than the per-run duplicate-key check -- cooldown runs first in the
  // pipeline and both mechanisms agree the mail must not go out twice.
  assert.equal(secondAttempt.status, 'skipped');
  assert.equal(secondAttempt.reason, 'cooldown');
  assert.equal(sendCount, 1);
});

test('two concurrent attempts for the same unfinished run race on the ledger insert, not the raw send', async () => {
  const ledger = createFakeLedger();
  let sendCount = 0;
  let releaseFirstSend;
  const firstSendGate = new Promise((resolve) => { releaseFirstSend = resolve; });

  const rawSender = async () => {
    sendCount += 1;
    if (sendCount === 1) await firstSendGate; // hold the first send in flight
    return { status: 'sent', provider: 'smtp', messageId: `msg-${sendCount}` };
  };
  const sendEmail = createSendEmail({ ledger, rawSender });
  const payload = { to: ['ops@example.com'], subject: 'Daily report', html: '<p>hi</p>' };
  const runCtx = { tenantId: 'tenant-1', workflowId: 'wf-1', runId: 'run-1' };

  const firstCall = runNotificationContext(runCtx, () => sendEmail(payload));
  // Give the first call time to insert its 'pending' ledger row before the second
  // starts, so the second collides on the unique dedupeKey rather than racing the
  // insert itself (Node's single-threaded event loop makes this deterministic here).
  await new Promise((resolve) => setImmediate(resolve));
  const secondCall = runNotificationContext(runCtx, () => sendEmail(payload));
  releaseFirstSend();

  const [first, second] = await Promise.all([firstCall, secondCall]);
  assert.equal(first.status, 'sent');
  assert.equal(second.status, 'suppressed');
  assert.equal(second.reason, 'duplicate');
  assert.equal(sendCount, 1);
});

test('a second run with identical content within the cooldown window is skipped, not resent', async () => {
  const ledger = createFakeLedger();
  const sendEmail = createSendEmail({
    ledger,
    rawSender: async () => ({ status: 'sent', provider: 'smtp', messageId: 'msg-x' })
  });

  const payload = { to: ['ops@example.com'], subject: 'Daily report', html: '<p>hi</p>' };
  const first = await runNotificationContext({ tenantId: 'tenant-1', workflowId: 'wf-1', runId: 'run-1' }, () => sendEmail(payload));
  assert.equal(first.status, 'sent');

  // A different run (e.g. tomorrow's cron), but the exact same rendered content --
  // this is the "identical mail every day" complaint the cooldown exists to kill.
  const secondRun = await runNotificationContext(
    { tenantId: 'tenant-1', workflowId: 'wf-1', runId: 'run-2' },
    () => sendEmail(payload)
  );
  assert.equal(secondRun.status, 'skipped');
  assert.equal(secondRun.reason, 'cooldown');
});

test('a second run with different content is not held back by the other content\'s cooldown', async () => {
  const ledger = createFakeLedger();
  const sendEmail = createSendEmail({
    ledger,
    rawSender: async () => ({ status: 'sent', provider: 'smtp', messageId: 'msg-x' })
  });

  await runNotificationContext(
    { tenantId: 'tenant-1', workflowId: 'wf-1', runId: 'run-1' },
    () => sendEmail({ to: ['ops@example.com'], subject: 'Daily report', html: '<p>day 1</p>' })
  );
  const secondRun = await runNotificationContext(
    { tenantId: 'tenant-1', workflowId: 'wf-1', runId: 'run-2' },
    () => sendEmail({ to: ['ops@example.com'], subject: 'Daily report', html: '<p>day 2, actually different</p>' })
  );
  assert.equal(secondRun.status, 'sent');
});

test('alwaysSend skips the content cooldown -- identical content sends again the next run', async () => {
  const ledger = createFakeLedger();
  let sendCount = 0;
  const sendEmail = createSendEmail({
    ledger,
    rawSender: async () => { sendCount += 1; return { status: 'sent', provider: 'smtp', messageId: `msg-${sendCount}` }; }
  });
  const payload = { to: ['ops@example.com'], subject: 'Daily report', html: '<p>same numbers as yesterday</p>' };

  const first = await runNotificationContext(
    { tenantId: 'tenant-1', workflowId: 'wf-1', runId: 'run-1', alwaysSend: true },
    () => sendEmail(payload)
  );
  const secondRun = await runNotificationContext(
    { tenantId: 'tenant-1', workflowId: 'wf-1', runId: 'run-2', alwaysSend: true },
    () => sendEmail(payload)
  );

  assert.equal(first.status, 'sent');
  assert.equal(secondRun.status, 'sent');
  assert.equal(sendCount, 2);
});

test('alwaysSend still blocks a genuine retry of the same run (per-run dedupe stays on)', async () => {
  const ledger = createFakeLedger();
  let sendCount = 0;
  const sendEmail = createSendEmail({
    ledger,
    rawSender: async () => { sendCount += 1; return { status: 'sent', provider: 'smtp', messageId: `msg-${sendCount}` }; }
  });
  const payload = { to: ['ops@example.com'], subject: 'Daily report', html: '<p>hi</p>' };
  const runCtx = { tenantId: 'tenant-1', workflowId: 'wf-1', runId: 'run-1', alwaysSend: true };

  const first = await runNotificationContext(runCtx, () => sendEmail(payload));
  const retried = await runNotificationContext(runCtx, () => sendEmail(payload));

  assert.equal(first.status, 'sent');
  assert.equal(retried.status, 'suppressed');
  assert.equal(retried.reason, 'duplicate');
  assert.equal(sendCount, 1);
});

test('sendEmail with no run context falls back to sending directly, ungated', async () => {
  let called = false;
  const sendEmail = createSendEmail({
    ledger: createFakeLedger(),
    rawSender: async () => { called = true; return { status: 'sent' }; }
  });

  const result = await sendEmail({ to: ['ops@example.com'], subject: 'Ad hoc', html: '<p>hi</p>' });
  assert.equal(result.status, 'sent');
  assert.equal(called, true);
});
