const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDurationMs, DEFAULT_MIN_INTERVAL_MS } = require('../server/lib/suppressionPipeline');
const { createNotificationService } = require('../server/services/notificationService');

test('parseDurationMs handles the documented unit suffixes', () => {
  assert.equal(parseDurationMs('24h'), 24 * 60 * 60 * 1000);
  assert.equal(parseDurationMs('30s'), 30 * 1000);
  assert.equal(parseDurationMs('5m'), 5 * 60 * 1000);
  assert.equal(parseDurationMs('7d'), 7 * 24 * 60 * 60 * 1000);
  assert.equal(parseDurationMs('500ms'), 500);
});

test('parseDurationMs accepts a plain number as milliseconds', () => {
  assert.equal(parseDurationMs(1500), 1500);
});

test('parseDurationMs falls back to the default rather than throwing on garbage input', () => {
  assert.equal(parseDurationMs('not-a-duration'), DEFAULT_MIN_INTERVAL_MS);
  assert.equal(parseDurationMs(undefined), DEFAULT_MIN_INTERVAL_MS);
  assert.equal(parseDurationMs(null), DEFAULT_MIN_INTERVAL_MS);
});

// End-to-end proof the fix actually changes pipeline behavior, not just the
// parser in isolation -- this is the exact bug that would have silently blocked
// rapid manual re-testing (cooldown was always a real 24h regardless of config).
function createFakeStore() {
  const states = new Map();
  const deliveries = [];
  return {
    states, deliveries,
    async getState(tenantId, stateKey) { return states.get(`${tenantId}|${stateKey}`) || null; },
    async listOpenExcluding() { return []; },
    async saveState(tenantId, stateKey, nextState) {
      const key = `${tenantId}|${stateKey}`;
      states.set(key, { ...(states.get(key) || {}), ...nextState, tenantId, stateKey });
    },
    async recordObservation() {},
    async recordLedgerRow() {},
    async getAlertShadowCooldownMinutes() { return null; },
    async pushToSpool() {},
    async deliver(payload) { deliveries.push(payload); return { status: 'sent' }; },
  };
}

function makeRun() {
  return { _id: 'run-1', tenantId: 'tenant-1', workflowId: 'wf-1', triggerType: 'event', context: { meta: { timezone: 'UTC' } } };
}

function entry(deltaPct) {
  return { dimension: 'product_id', value: '1', display_value: 'Product A', path: [], base_metric: 'cvr', deltas: { cvr_delta_pct: deltaPct }, sessionShare: 0.5 };
}

function makeResult(entries) {
  return { status: 'completed', context: { meta: { timezone: 'UTC', window: { end: '2026-01-01T00:00:00.000Z' } }, breakdowns: { cvr_product_drops: entries } } };
}

function primeRecentlyNotifiedState(store, stateKey, magnitude) {
  store.states.set('tenant-1|' + stateKey, {
    stateKey, status: 'active',
    currentEpisode: { lastNotifiedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(), lastNotifiedMagnitude: magnitude },
  });
}

test('without a configured min_interval, a worsening reading 1 minute later is still blocked by the real 24h default', async () => {
  const store = createFakeStore();
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:01:00.000Z') });

  const declared = {
    status: 'completed',
    context: {
      meta: { timezone: 'UTC', window: { end: '2026-01-01T00:01:00.000Z' } },
      alertStates: { transitions: [{
        stateKey: 'tenant-1/wf-1:hash', transition: 'escalation', notify: true, criticalBypass: false,
        finding: { entry: entry(-60) },
        snapshot: { episodeCount: 1, currentEpisode: { peakSeverityTier: null, lastNotifiedMagnitude: -30 } },
      }] },
    },
  };
  primeRecentlyNotifiedState(store, 'tenant-1/wf-1:hash', -30);

  const decisions = await service.enforceObserve({ run: makeRun(), result: declared });
  assert.equal(decisions[0].decision.action, 'suppress');
  assert.equal(decisions[0].decision.reason, 'cooldown');
});

test('a short min_interval lets that same worsening reading through instead of waiting a real 24h', async () => {
  const store = createFakeStore();
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:01:00.000Z') });

  const declared = {
    status: 'completed',
    context: {
      meta: { timezone: 'UTC', window: { end: '2026-01-01T00:01:00.000Z' } },
      alertStates: { transitions: [{
        stateKey: 'tenant-1/wf-1:hash', transition: 'escalation', notify: true, criticalBypass: false,
        finding: { entry: entry(-60) },
        snapshot: { episodeCount: 1, currentEpisode: { peakSeverityTier: null, lastNotifiedMagnitude: -30 } },
      }] },
    },
  };
  primeRecentlyNotifiedState(store, 'tenant-1/wf-1:hash', -30);

  const decisions = await service.enforceObserve({
    run: makeRun(), result: declared, options: { notifyPolicy: { min_interval: '1s' } }
  });
  assert.equal(decisions[0].decision.action, 'send');
});
