const test = require('node:test');
const assert = require('node:assert/strict');

const { createNotificationService } = require('../server/services/notificationService');

function createFakeStore({ staleAfterMsByWorkflow = {} } = {}) {
  const states = new Map();
  const ledgerRows = [];

  return {
    states, ledgerRows,
    seedState(state) { states.set(`${state.tenantId}|${state.stateKey}`, { ...state }); },
    async findStaleCandidates() {
      return Array.from(states.values()).filter((s) => ['active', 'recovering'].includes(s.status));
    },
    async getStaleAfterMs(tenantId, workflowId) {
      return staleAfterMsByWorkflow[workflowId] ?? null;
    },
    async saveState(tenantId, stateKey, nextState) {
      const key = `${tenantId}|${stateKey}`;
      states.set(key, { ...(states.get(key) || {}), ...nextState });
    },
    async recordLedgerRow(entry) { ledgerRows.push(entry); },
    async deliver() { throw new Error('sweepStaleFindings must never call deliver'); },
  };
}

test('a workflow with no stale_after configured is skipped entirely (off by default)', async () => {
  const store = createFakeStore({ staleAfterMsByWorkflow: {} });
  store.seedState({
    tenantId: 'tenant-1', stateKey: 'k1', workflowId: 'wf-1', status: 'active',
    lastSeenAt: '2020-01-01T00:00:00.000Z', lastObservationKey: 'obs-1',
  });
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:00:00.000Z') });

  const result = await service.sweepStaleFindings();
  assert.equal(result.count, 0);
  assert.equal(store.states.get('tenant-1|k1').status, 'active');
  assert.equal(store.ledgerRows.length, 0);
});

test('a candidate past its workflow\'s stale_after transitions to stale and logs a suppressed row, never sends', async () => {
  const store = createFakeStore({ staleAfterMsByWorkflow: { 'wf-1': 24 * 60 * 60 * 1000 } });
  store.seedState({
    tenantId: 'tenant-1', stateKey: 'k1', workflowId: 'wf-1', status: 'active',
    lastSeenAt: '2025-12-30T00:00:00.000Z', lastObservationKey: 'obs-1',
  });
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:00:00.000Z') });

  const result = await service.sweepStaleFindings();
  assert.equal(result.count, 1);
  assert.equal(store.states.get('tenant-1|k1').status, 'stale');
  assert.equal(store.ledgerRows.length, 1);
  assert.equal(store.ledgerRows[0].status, 'suppressed');
  assert.equal(store.ledgerRows[0].suppressedReason, 'stale_no_notify');
});

test('a candidate within its stale_after window is left alone', async () => {
  const store = createFakeStore({ staleAfterMsByWorkflow: { 'wf-1': 24 * 60 * 60 * 1000 } });
  store.seedState({
    tenantId: 'tenant-1', stateKey: 'k1', workflowId: 'wf-1', status: 'active',
    lastSeenAt: '2026-01-01T00:00:00.000Z', lastObservationKey: 'obs-1',
  });
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T01:00:00.000Z') });

  const result = await service.sweepStaleFindings();
  assert.equal(result.count, 0);
  assert.equal(store.states.get('tenant-1|k1').status, 'active');
});

test('a resolved or muted finding is never a stale candidate', async () => {
  const store = createFakeStore({ staleAfterMsByWorkflow: { 'wf-1': 1000 } });
  store.seedState({ tenantId: 'tenant-1', stateKey: 'resolved-1', workflowId: 'wf-1', status: 'resolved', lastSeenAt: '2020-01-01T00:00:00.000Z' });
  store.seedState({ tenantId: 'tenant-1', stateKey: 'muted-1', workflowId: 'wf-1', status: 'muted', lastSeenAt: '2020-01-01T00:00:00.000Z' });
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:00:00.000Z') });

  const result = await service.sweepStaleFindings();
  assert.equal(result.count, 0);
});

test('one failing candidate does not block the sweep from staling the rest', async () => {
  const store = createFakeStore({ staleAfterMsByWorkflow: { 'wf-1': 1000, 'wf-2': 1000 } });
  store.seedState({ tenantId: 'tenant-1', stateKey: 'bad', workflowId: 'wf-1', status: 'active', lastSeenAt: '2020-01-01T00:00:00.000Z' });
  store.seedState({ tenantId: 'tenant-1', stateKey: 'good', workflowId: 'wf-2', status: 'active', lastSeenAt: '2020-01-01T00:00:00.000Z' });

  const originalGetStaleAfterMs = store.getStaleAfterMs.bind(store);
  store.getStaleAfterMs = async (tenantId, workflowId) => {
    if (workflowId === 'wf-1') throw new Error('boom');
    return originalGetStaleAfterMs(tenantId, workflowId);
  };

  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:00:00.000Z') });
  const result = await service.sweepStaleFindings();
  assert.equal(result.count, 1);
  assert.equal(store.states.get('tenant-1|good').status, 'stale');
});
