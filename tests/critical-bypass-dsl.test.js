const test = require('node:test');
const assert = require('node:assert/strict');

const { createNotificationService } = require('../server/services/notificationService');

function createFakeStore(primedState) {
  const states = new Map();
  if (primedState) states.set(`tenant-1|${primedState.stateKey}`, primedState);
  const deliveries = [];
  const ledgerRows = [];

  return {
    states, deliveries, ledgerRows,
    async getState(tenantId, stateKey) { return states.get(`${tenantId}|${stateKey}`) || null; },
    async listOpenExcluding() { return []; },
    async saveState(tenantId, stateKey, nextState) {
      const key = `${tenantId}|${stateKey}`;
      states.set(key, { ...(states.get(key) || {}), ...nextState, tenantId, stateKey });
    },
    async recordObservation() {},
    async recordLedgerRow(entry) { ledgerRows.push(entry); },
    async getAlertShadowCooldownMinutes() { return null; },
    async pushToSpool() {},
    async deliver(payload) { deliveries.push(payload); return { status: 'sent' }; },
  };
}

function declaredResult({ criticalBypass }) {
  return {
    status: 'completed',
    context: {
      meta: { timezone: 'UTC', window: { end: '2026-01-05T00:00:00.000Z' } },
      alertStates: {
        transitions: [{
          stateKey: 'tenant-1/wf-1:hash',
          transition: 'escalation',
          notify: true,
          criticalBypass,
          finding: { entry: { dimension: 'product_id', value: '1', deltas: { cvr_delta_pct: -60 } } },
          snapshot: {
            firstSeenAt: '2026-01-01T00:00:00.000Z',
            episodeCount: 1,
            currentEpisode: { peakSeverityTier: 'critical', lastNotifiedMagnitude: -30 },
          },
        }],
      },
    },
  };
}

function primedRecentlyNotified() {
  // Notified 1 minute ago -- well inside the 24h default cooldown, so only the
  // critical bypass (or its absence) determines whether this fires again.
  return {
    stateKey: 'tenant-1/wf-1:hash',
    status: 'active',
    currentEpisode: { lastNotifiedAt: new Date('2026-01-04T23:59:00.000Z').toISOString(), lastNotifiedMagnitude: -30 },
  };
}

function makeRun() {
  return { _id: 'run-1', tenantId: 'tenant-1', workflowId: 'wf-1', triggerType: 'event', context: { meta: { timezone: 'UTC' } } };
}

test('by default, a critical-severity escalation bypasses cooldown and sends', async () => {
  const store = createFakeStore(primedRecentlyNotified());
  const service = createNotificationService({ store, now: () => new Date('2026-01-05T00:00:00.000Z') });

  const decisions = await service.enforceObserve({ run: makeRun(), result: declaredResult({ criticalBypass: true }) });
  assert.equal(decisions[0].decision.action, 'send');
  // Gap #2: 'send' now writes a pending ledger row rather than delivering inline.
  assert.equal(store.deliveries.length, 0);
  assert.equal(store.ledgerRows.filter((r) => r.status === 'pending').length, 1);
});

test('notify_policy.critical_bypass.enabled: false makes the same reading respect cooldown instead', async () => {
  const store = createFakeStore(primedRecentlyNotified());
  const service = createNotificationService({ store, now: () => new Date('2026-01-05T00:00:00.000Z') });

  const decisions = await service.enforceObserve({
    run: makeRun(),
    result: declaredResult({ criticalBypass: true }),
    options: { notifyPolicy: { critical_bypass: { enabled: false } } },
  });
  assert.equal(decisions[0].decision.action, 'suppress');
  assert.equal(decisions[0].decision.reason, 'cooldown');
  assert.equal(store.deliveries.length, 0);
});
