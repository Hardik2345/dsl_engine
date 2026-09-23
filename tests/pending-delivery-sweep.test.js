const test = require('node:test');
const assert = require('node:assert/strict');

const { createNotificationService } = require('../server/services/notificationService');

function createFakeStore() {
  const ledgerRows = new Map();
  const states = new Map();
  const deliveries = [];
  let deliverImpl = async () => ({ status: 'sent', provider: 'fake', messageId: 'msg-1' });

  return {
    ledgerRows, states, deliveries,
    setDeliverImpl(fn) { deliverImpl = fn; },
    seedLedgerRow(row) { ledgerRows.set(row._id, { ...row }); },
    seedState(tenantId, stateKey, doc) { states.set(`${tenantId}|${stateKey}`, doc); },
    async findDuePendingLedgerRows(cutoff) {
      return Array.from(ledgerRows.values()).filter((r) =>
        r.status === 'pending' && (!r.nextAttemptAt || new Date(r.nextAttemptAt).getTime() <= cutoff.getTime())
      );
    },
    async markLedgerDelivered(tenantId, id, status, extra = {}) {
      const row = ledgerRows.get(id);
      ledgerRows.set(id, { ...row, status, ...extra });
    },
    async bumpLedgerAttempt(tenantId, id, nextAttemptAt) {
      const row = ledgerRows.get(id);
      ledgerRows.set(id, { ...row, nextAttemptAt, attempt: (row.attempt || 0) + 1 });
    },
    async saveState(tenantId, stateKey, nextState) {
      const key = `${tenantId}|${stateKey}`;
      states.set(key, { ...(states.get(key) || {}), ...nextState });
    },
    async deliver(payload) { deliveries.push(payload); return deliverImpl(payload); },
  };
}

test('a due pending row is delivered, marked sent, and bumps lastNotifiedAt only after delivery', async () => {
  const store = createFakeStore();
  store.seedLedgerRow({
    _id: 'ledger-1', tenantId: 'tenant-1', stateKey: 'tenant-1/wf-1:hash', status: 'pending',
    recipients: ['ops@example.com'], subject: '[NEW] Product A', renderedHtml: '<p>hi</p>', renderedText: 'hi',
    nextAttemptAt: '2026-01-01T00:00:00.000Z', attempt: 0,
    pendingStateSnapshot: { currentEpisode: { lastNotifiedMagnitude: -30 } },
  });

  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:05:00.000Z') });
  const result = await service.sweepPendingDeliveries();

  assert.equal(result.count, 1);
  assert.equal(store.deliveries.length, 1);
  assert.equal(store.ledgerRows.get('ledger-1').status, 'sent');
  const state = store.states.get('tenant-1|tenant-1/wf-1:hash');
  assert.equal(state.currentEpisode.lastNotifiedAt.toISOString(), '2026-01-01T00:05:00.000Z');
  assert.equal(state.currentEpisode.lastNotifiedMagnitude, -30);
});

test('a row not yet due is left alone', async () => {
  const store = createFakeStore();
  store.seedLedgerRow({
    _id: 'ledger-1', tenantId: 'tenant-1', stateKey: 'k', status: 'pending',
    nextAttemptAt: '2026-01-02T00:00:00.000Z', attempt: 0,
  });
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:00:00.000Z') });
  const result = await service.sweepPendingDeliveries();
  assert.equal(result.count, 0);
  assert.equal(store.deliveries.length, 0);
  assert.equal(store.ledgerRows.get('ledger-1').status, 'pending');
});

test('a failed delivery is backed off with a later nextAttemptAt, not marked failed immediately', async () => {
  const store = createFakeStore();
  store.setDeliverImpl(async () => ({ status: 'failed', error: 'smtp down' }));
  store.seedLedgerRow({
    _id: 'ledger-1', tenantId: 'tenant-1', stateKey: 'k', status: 'pending',
    nextAttemptAt: '2026-01-01T00:00:00.000Z', attempt: 0,
  });
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:05:00.000Z') });
  await service.sweepPendingDeliveries();

  const row = store.ledgerRows.get('ledger-1');
  assert.equal(row.status, 'pending');
  assert.equal(row.attempt, 1);
  assert.ok(new Date(row.nextAttemptAt).getTime() > new Date('2026-01-01T00:05:00.000Z').getTime());
});

test('a delivery that exhausts all retry attempts is finally marked failed', async () => {
  const store = createFakeStore();
  store.setDeliverImpl(async () => ({ status: 'failed', error: 'smtp down' }));
  store.seedLedgerRow({
    _id: 'ledger-1', tenantId: 'tenant-1', stateKey: 'k', status: 'pending',
    nextAttemptAt: '2026-01-01T00:00:00.000Z', attempt: 4, // one below the 5-attempt cap used by sweepPendingDeliveries
  });
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:05:00.000Z') });
  await service.sweepPendingDeliveries();

  const row = store.ledgerRows.get('ledger-1');
  assert.equal(row.status, 'failed');
  assert.equal(row.lastError, 'smtp down');
});

test('one failing row does not block another due row from being delivered', async () => {
  const store = createFakeStore();
  let calls = 0;
  store.setDeliverImpl(async () => {
    calls += 1;
    if (calls === 1) throw new Error('transient error');
    return { status: 'sent' };
  });
  store.seedLedgerRow({ _id: 'ledger-1', tenantId: 'tenant-1', stateKey: 'k1', status: 'pending', nextAttemptAt: '2026-01-01T00:00:00.000Z', attempt: 0 });
  store.seedLedgerRow({ _id: 'ledger-2', tenantId: 'tenant-1', stateKey: 'k2', status: 'pending', nextAttemptAt: '2026-01-01T00:00:00.000Z', attempt: 0 });

  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:05:00.000Z') });
  const result = await service.sweepPendingDeliveries();

  assert.equal(result.count, 1);
  assert.equal(store.ledgerRows.get('ledger-2').status, 'sent');
});
