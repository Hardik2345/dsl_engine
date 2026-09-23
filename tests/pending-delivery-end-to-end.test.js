const test = require('node:test');
const assert = require('node:assert/strict');

const WorkflowRunner = require('../engine/WorkflowRunner');
const { createNotificationService } = require('../server/services/notificationService');

function buildWorkflow() {
  return {
    workflow_type: 'root_cause_analysis',
    version: '1',
    workflow_id: 'cvr_state_demo',
    trigger: { type: 'alert', alertType: 'cvr_drop', brandScope: 'single', brandIds: ['tenant-1'] },
    nodes: [
      {
        id: 'evaluate_state',
        type: 'alert_state',
        sources: [{ output_key: 'cvr_product_drops', metric: 'cvr', direction: 'drop' }],
        breach: {
          enter: [{ metric: 'cvr_delta_pct', op: '<', value: -10 }],
          exit: [{ metric: 'cvr_delta_pct', op: '>', value: -5 }],
        },
        then: 'send_finding_email',
        then_no_changes: null,
      },
      {
        id: 'send_finding_email',
        type: 'email',
        format: 'finding',
        for_each: 'alertStates.transitions',
        to: ['ops@example.com'],
        subject: 'ignored',
      },
    ],
  };
}

function createFakeStore() {
  const states = new Map();
  const ledgerRows = new Map();
  const deliveries = [];
  let nextId = 1;

  return {
    states, ledgerRows, deliveries,
    async getState(tenantId, stateKey) { return states.get(`${tenantId}|${stateKey}`) || null; },
    async listOpenExcluding() { return []; },
    async saveState(tenantId, stateKey, nextState) {
      const key = `${tenantId}|${stateKey}`;
      states.set(key, { ...(states.get(key) || {}), ...nextState, tenantId, stateKey });
    },
    async recordObservation() {},
    async recordLedgerRow(entry) {
      const id = `ledger-${nextId++}`;
      ledgerRows.set(id, { _id: id, ...entry });
    },
    async getAlertShadowCooldownMinutes() { return null; },
    async pushToSpool() {},
    async findDuePendingLedgerRows(cutoff) {
      return Array.from(ledgerRows.values()).filter((r) => r.status === 'pending' && new Date(r.nextAttemptAt).getTime() <= cutoff.getTime());
    },
    async markLedgerDelivered(tenantId, id, status, extra = {}) {
      ledgerRows.set(id, { ...ledgerRows.get(id), status, ...extra });
    },
    async bumpLedgerAttempt(tenantId, id, nextAttemptAt) {
      const row = ledgerRows.get(id);
      ledgerRows.set(id, { ...row, nextAttemptAt, attempt: (row.attempt || 0) + 1 });
    },
    async deliver() { deliveries.push(1); return { status: 'sent', provider: 'fake', messageId: 'msg-1' }; },
  };
}

test('a real workflow run reaches a pending ledger row, and the sweep delivers it end to end', async () => {
  const alertStateReader = { async getState() { return null; }, async listOpenExcluding() { return []; } };
  const runner = new WorkflowRunner(buildWorkflow(), { workflowIdentity: 'tenant-1/cvr_state_demo@1', alertStateReader });

  const context = {
    meta: { tenantId: 'tenant-1', timezone: 'UTC', window: { end: '2026-01-05T00:00:00.000Z' } },
    filters: [], metrics: [], rootCausePath: [], scratch: {},
    breakdowns: {
      cvr_product_drops: [
        { dimension: 'product_id', value: '111', display_value: 'Product A', path: [], base_metric: 'cvr', deltas: { cvr_delta_pct: -60 }, sessionShare: 0.5 },
      ],
    },
  };

  const result = await runner.executeWorkflow(context);
  assert.equal(result.status, 'completed');
  assert.equal(result.context.alertStates.transitions.length, 1);

  const store = createFakeStore();
  const service = createNotificationService({ store, now: () => new Date('2026-01-05T00:00:00.000Z') });
  const run = { _id: 'run-1', tenantId: 'tenant-1', workflowId: 'cvr_state_demo', triggerType: 'event', context: result.context };

  const decisions = await service.enforceObserve({ run, result });
  assert.equal(decisions[0].decision.action, 'send');

  const pendingRows = Array.from(store.ledgerRows.values()).filter((r) => r.status === 'pending');
  assert.equal(pendingRows.length, 1);
  assert.equal(store.deliveries.length, 0); // not delivered yet -- gap #2's whole point

  const stateKey = pendingRows[0].stateKey;
  const ledgerId = pendingRows[0]._id;

  const sweepResult = await service.sweepPendingDeliveries();
  assert.equal(sweepResult.count, 1);
  assert.equal(store.deliveries.length, 1);
  assert.equal(store.ledgerRows.get(ledgerId).status, 'sent');
  const state = store.states.get(`tenant-1|${stateKey}`);
  // lastNotifiedAt is only set by the sweep, never by enforceObserve itself.
  assert.ok(state.currentEpisode.lastNotifiedAt);
});
