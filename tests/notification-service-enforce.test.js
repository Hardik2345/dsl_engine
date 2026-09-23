const test = require('node:test');
const assert = require('node:assert/strict');

const { createNotificationService } = require('../server/services/notificationService');

function createFakeStore() {
  const states = new Map();
  const observations = [];
  const ledgerRows = [];
  const spools = new Map();
  const deliveries = [];

  return {
    states, observations, ledgerRows, spools, deliveries,
    async getState(tenantId, stateKey) {
      return states.get(`${tenantId}|${stateKey}`) || null;
    },
    async listOpenExcluding(tenantId, scopeKey, excludeStateKeys) {
      const excluded = new Set(excludeStateKeys);
      return Array.from(states.values()).filter((doc) =>
        doc.tenantId === tenantId
        && doc.stateKey.startsWith(`${scopeKey}:`)
        && !excluded.has(doc.stateKey)
        && ['active', 'recovering'].includes(doc.status)
      );
    },
    async saveState(tenantId, stateKey, nextState) {
      const key = `${tenantId}|${stateKey}`;
      const existing = states.get(key) || {};
      states.set(key, { ...existing, ...nextState, tenantId, stateKey });
    },
    async recordObservation(observation) { observations.push(observation); },
    async recordLedgerRow(entry) { ledgerRows.push(entry); },
    async getAlertShadowCooldownMinutes() { return null; },
    async pushToSpool({ tenantId, digestKey, item }) {
      const key = `${tenantId}|${digestKey}`;
      if (!spools.has(key)) spools.set(key, { items: [] });
      spools.get(key).items.push(item);
    },
    async deliver(payload) {
      deliveries.push(payload);
      return { status: 'sent', provider: 'fake', messageId: `msg-${deliveries.length}` };
    },
  };
}

// Gap #2: a 'send' decision now writes a pending ledger row instead of calling
// store.deliver synchronously -- actual delivery happens later via
// sweepPendingDeliveries. Tests assert against these pending rows rather than
// store.deliveries.
function pendingRows(store) {
  return store.ledgerRows.filter((row) => row.status === 'pending');
}

function makeRun(overrides = {}) {
  return { _id: 'run-1', tenantId: 'tenant-1', workflowId: 'wf-1', triggerType: 'event', context: { meta: { timezone: 'UTC' } }, ...overrides };
}

function makeResult(entries) {
  return {
    status: 'completed',
    context: {
      meta: { timezone: 'UTC', window: { end: '2026-01-01T00:00:00.000Z' } },
      breakdowns: { cvr_product_drops: entries },
    },
  };
}

function entry(overrides = {}) {
  return {
    dimension: 'product_id', value: '111', display_value: 'Product A', path: [], base_metric: 'cvr',
    deltas: { cvr_delta_pct: -30 }, sessionShare: 0.4,
    ...overrides,
  };
}

test('a brand-new finding is sent immediately', async () => {
  const store = createFakeStore();
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:00:00.000Z') });

  const decisions = await service.enforceObserve({ run: makeRun(), result: makeResult([entry()]) });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision.action, 'send');
  assert.equal(store.deliveries.length, 0); // not delivered synchronously
  assert.equal(pendingRows(store).length, 1);
  assert.match(pendingRows(store)[0].subject, /^\[NEW\]/);
});

test('dedupeKey includes runId, so two separate runs against the identical fixed window never collide', async () => {
  // The fake store doesn't simulate Mongo's unique index on {tenantId, dedupeKey},
  // so this can't catch a real collision -- it locks in the key FORMAT instead,
  // which is what a real E11000 collision would depend on. Before this fix, two
  // manual re-runs of the same analysis window (routine during testing, and
  // possible in production via a rerun) produced byte-identical dedupeKeys and the
  // second run's ledger row silently vanished, even though its own decision could
  // differ (e.g. cooldown vs quiet_hours) from the first run's.
  const store = createFakeStore();
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:00:00.000Z') });

  await service.enforceObserve({ run: makeRun({ _id: 'run-a' }), result: makeResult([entry()]) });
  await service.enforceObserve({ run: makeRun({ _id: 'run-b' }), result: makeResult([entry()]) });

  const dedupeKeys = store.ledgerRows.map((row) => row.dedupeKey);
  assert.equal(dedupeKeys.length, 2);
  assert.notEqual(dedupeKeys[0], dedupeKeys[1]);
  assert.match(dedupeKeys[0], /\|run-a$/);
  assert.match(dedupeKeys[1], /\|run-b$/);
});

test('the same unresolved finding does not re-send the next day (cooldown)', async () => {
  const store = createFakeStore();
  let currentTime = new Date('2026-01-01T00:00:00.000Z');
  const service = createNotificationService({ store, now: () => currentTime });

  await service.enforceObserve({ run: makeRun(), result: makeResult([entry({ deltas: { cvr_delta_pct: -30 } })]) });
  assert.equal(pendingRows(store).length, 1);

  currentTime = new Date('2026-01-02T00:00:00.000Z');
  const secondDay = await service.enforceObserve({
    run: makeRun(),
    result: makeResult([entry({ deltas: { cvr_delta_pct: -31 } })]),
  });

  // Same finding, roughly the same magnitude -- no escalation transition at all,
  // so it's suppressed for "no_transition" before cooldown is even evaluated.
  assert.equal(pendingRows(store).length, 1);
  assert.equal(secondDay[0], undefined);
});

test('a muted finding is never sent even after a large escalation (severity tiers arrive in Phase 3)', async () => {
  const store = createFakeStore();
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:00:00.000Z') });

  await store.saveState('tenant-1', 'placeholder', {}); // sanity: store works before priming real state

  // Prime an existing muted, active finding by running it once, then muting it.
  await service.enforceObserve({ run: makeRun(), result: makeResult([entry()]) });
  const stateKey = Array.from(store.states.keys()).find((k) => k !== 'tenant-1|placeholder').split('|').slice(1).join('|');
  const existing = store.states.get(`tenant-1|${stateKey}`);
  store.states.set(`tenant-1|${stateKey}`, { ...existing, mutedAt: new Date('2026-01-01T00:00:00.000Z') });

  const decisions = await service.enforceObserve({
    run: makeRun(),
    result: makeResult([entry({ deltas: { cvr_delta_pct: -60 } })]),
  });

  const findingDecision = decisions.find((d) => d.stateKey === stateKey);
  assert.equal(findingDecision.decision.action, 'suppress');
  assert.equal(findingDecision.decision.reason, 'muted');
});

test('a resolved finding sends recovery mail once two clean readings land', async () => {
  const store = createFakeStore();
  let currentTime = new Date('2026-01-01T00:00:00.000Z');
  const service = createNotificationService({ store, now: () => currentTime });

  await service.enforceObserve({ run: makeRun(), result: makeResult([entry()]) });
  const stateKey = Array.from(store.states.keys())[0].split('|').slice(1).join('|');

  currentTime = new Date('2026-01-02T00:00:00.000Z');
  await service.enforceObserve({ run: makeRun(), result: makeResult([]) }); // clean #1
  currentTime = new Date('2026-01-03T00:00:00.000Z');
  const decisions = await service.enforceObserve({ run: makeRun(), result: makeResult([]) }); // clean #2

  const resolvedDecision = decisions.find((d) => d.stateKey === stateKey);
  assert.equal(resolvedDecision.transition, 'resolved');
  assert.equal(resolvedDecision.decision.action, 'send');
  const rows = pendingRows(store);
  assert.match(rows[rows.length - 1].subject, /^\[RESOLVED\]/);
});

test('a resolution sends even when it lands inside the cooldown window of the original alert', async () => {
  const store = createFakeStore();
  let currentTime = new Date('2026-01-01T00:00:00.000Z');
  const service = createNotificationService({ store, now: () => currentTime });

  // Opens the finding at min_interval's default (24h) -- everything below stays
  // well inside that window, unlike the day-spanning test above.
  await service.enforceObserve({ run: makeRun(), result: makeResult([entry()]) });
  const stateKey = Array.from(store.states.keys())[0].split('|').slice(1).join('|');

  currentTime = new Date('2026-01-01T00:05:00.000Z'); // clean #1, 5 minutes later
  await service.enforceObserve({ run: makeRun(), result: makeResult([]) });
  currentTime = new Date('2026-01-01T00:10:00.000Z'); // clean #2, 10 minutes after open
  const decisions = await service.enforceObserve({ run: makeRun(), result: makeResult([]) });

  const resolvedDecision = decisions.find((d) => d.stateKey === stateKey);
  assert.equal(resolvedDecision.transition, 'resolved');
  // Must not be suppressed as 'cooldown' -- a fixed-it notification is exactly the
  // kind of message a rate limit meant for repeat "still broken" alerts must not
  // silently eat.
  assert.equal(resolvedDecision.decision.action, 'send');
  const rows = pendingRows(store);
  assert.match(rows[rows.length - 1].subject, /^\[RESOLVED\]/);
});

test('a recurrence sends even when it lands inside the cooldown window of the original alert', async () => {
  const store = createFakeStore();
  let currentTime = new Date('2026-01-01T00:00:00.000Z');
  const service = createNotificationService({ store, now: () => currentTime });

  await service.enforceObserve({ run: makeRun(), result: makeResult([entry()]) }); // opens
  const stateKey = Array.from(store.states.keys())[0].split('|').slice(1).join('|');

  currentTime = new Date('2026-01-01T00:05:00.000Z'); // clean #1
  await service.enforceObserve({ run: makeRun(), result: makeResult([]) });
  currentTime = new Date('2026-01-01T00:10:00.000Z'); // clean #2 -> resolves
  await service.enforceObserve({ run: makeRun(), result: makeResult([]) });

  currentTime = new Date('2026-01-01T00:15:00.000Z'); // breaches again 15 min after the original alert
  const decisions = await service.enforceObserve({ run: makeRun(), result: makeResult([entry()]) });

  const recurrenceDecision = decisions.find((d) => d.stateKey === stateKey);
  assert.equal(recurrenceDecision.transition, 'recurrence');
  assert.equal(recurrenceDecision.decision.action, 'send');
});

test('more findings than the burst cap roll the overflow into a digest spool', async () => {
  const store = createFakeStore();
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:00:00.000Z') });

  const entries = Array.from({ length: 8 }, (_, i) => entry({
    value: String(i), display_value: `Product ${i}`, deltas: { cvr_delta_pct: -10 - i }
  }));

  const decisions = await service.enforceObserve({
    run: makeRun(), result: makeResult(entries), options: { notifyPolicy: { burst_cap: { max_immediate: 3 } } }
  });

  const sent = decisions.filter((d) => d.decision.action === 'send');
  const digested = decisions.filter((d) => d.decision.action === 'digest');
  assert.equal(sent.length, 3);
  assert.equal(digested.length, 5);
  assert.equal(pendingRows(store).length, 3);
});

test('a dry run computes decisions but sends nothing', async () => {
  const store = createFakeStore();
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T00:00:00.000Z') });

  const decisions = await service.enforceObserve({ run: makeRun(), result: makeResult([entry()]), options: { dryRun: true } });
  assert.equal(decisions[0].decision.action, 'suppress');
  assert.equal(decisions[0].decision.reason, 'dry_run');
  assert.equal(store.deliveries.length, 0);
});
