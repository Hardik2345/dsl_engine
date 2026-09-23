const test = require('node:test');
const assert = require('node:assert/strict');

const { createNotificationService } = require('../server/services/notificationService');

// Gap #1: flushDigest/sweepOpenDigests now go through the store like every other
// function in notificationService.js, so they're properly behavior-testable with a
// fake store -- no real Mongo connection needed.
function createFakeStore() {
  const spools = new Map();
  const deliveries = [];

  return {
    spools, deliveries,
    seedSpool(spool) { spools.set(`${spool.tenantId}|${spool.digestKey}`, { ...spool }); },
    async findOpenSpool(tenantId, digestKey) {
      const spool = spools.get(`${tenantId}|${digestKey}`);
      return spool && spool.status === 'open' ? spool : null;
    },
    async markSpoolFlushed(tenantId, digestKey, flushedAt) {
      const key = `${tenantId}|${digestKey}`;
      const spool = spools.get(key);
      if (spool) spools.set(key, { ...spool, status: 'flushed', flushedAt });
    },
    async findDueSpools(cutoff) {
      return Array.from(spools.values()).filter((s) => s.status === 'open' && new Date(s.windowEnd).getTime() <= cutoff.getTime());
    },
    async deliver(payload) { deliveries.push(payload); return { status: 'sent' }; },
    async getFindingEmailRecipients() { return ['ops@example.com']; },
  };
}

test('flushDigest renders, delivers, and marks the spool flushed', async () => {
  const store = createFakeStore();
  store.seedSpool({
    tenantId: 'tenant-1', digestKey: 'wf-1|digest', status: 'open',
    windowStart: '2026-01-01T00:00:00.000Z', windowEnd: '2026-01-01T00:00:00.000Z',
    items: [{ stateKey: 'a', transition: 'new', snapshot: { label: 'Product A', deltaPct: -20 } }],
  });
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T01:00:00.000Z') });

  const delivery = await service.flushDigest({ tenantId: 'tenant-1', digestKey: 'wf-1|digest' });
  assert.equal(delivery.status, 'sent');
  assert.equal(store.deliveries.length, 1);
  assert.match(store.deliveries[0].subject, /DIGEST/);
  assert.equal(store.spools.get('tenant-1|wf-1|digest').status, 'flushed');
});

test('flushDigest is a no-op for a spool that does not exist or has no items', async () => {
  const store = createFakeStore();
  const service = createNotificationService({ store, now: () => new Date() });
  const result = await service.flushDigest({ tenantId: 'tenant-1', digestKey: 'missing' });
  assert.equal(result, null);
  assert.equal(store.deliveries.length, 0);
});

test('sweepOpenDigests flushes only spools past the age cutoff', async () => {
  const store = createFakeStore();
  store.seedSpool({
    tenantId: 'tenant-1', digestKey: 'old', status: 'open',
    windowStart: '2026-01-01T00:00:00.000Z', windowEnd: '2026-01-01T00:00:00.000Z',
    items: [{ stateKey: 'a', transition: 'new', snapshot: { label: 'Old', deltaPct: -20 } }],
  });
  store.seedSpool({
    tenantId: 'tenant-1', digestKey: 'fresh', status: 'open',
    windowStart: '2026-01-01T05:59:00.000Z', windowEnd: '2026-01-01T05:59:00.000Z',
    items: [{ stateKey: 'b', transition: 'new', snapshot: { label: 'Fresh', deltaPct: -20 } }],
  });
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T06:00:00.000Z') });

  const result = await service.sweepOpenDigests({ olderThanMs: 5 * 60 * 1000 });
  assert.equal(result.count, 1);
  assert.equal(store.spools.get('tenant-1|old').status, 'flushed');
  assert.equal(store.spools.get('tenant-1|fresh').status, 'open');
});

test('flushDigest resolves recipients via the store when none are passed in options, and does not mark flushed on delivery failure', async () => {
  const store = createFakeStore();
  store.seedSpool({
    tenantId: 'tenant-1', digestKey: 'wf-2|digest', status: 'open',
    windowStart: '2026-01-01T00:00:00.000Z', windowEnd: '2026-01-01T00:00:00.000Z',
    items: [{ stateKey: 'a', transition: 'new', snapshot: { label: 'Product A', deltaPct: -20 } }],
  });
  let recipientsSeen = null;
  store.deliver = async (payload) => { recipientsSeen = payload.to; return { status: 'failed', error: 'at least one recipient is required' }; };
  const service = createNotificationService({ store, now: () => new Date('2026-01-01T01:00:00.000Z') });

  const delivery = await service.flushDigest({ tenantId: 'tenant-1', digestKey: 'wf-2|digest' });
  assert.deepEqual(recipientsSeen, ['ops@example.com']);
  assert.equal(delivery.status, 'failed');
  // A failed send must leave the spool open so the next sweep tick retries it,
  // instead of silently discarding the digest the way the original bug did.
  assert.equal(store.spools.get('tenant-1|wf-2|digest').status, 'open');
});

test('sweepOpenDigests isolates a throwing spool and still processes the rest', async () => {
  const store = createFakeStore();
  store.seedSpool({ tenantId: 'tenant-1', digestKey: 'bad', status: 'open', windowStart: '2026-01-01T00:00:00.000Z', windowEnd: '2026-01-01T00:00:00.000Z', items: [{ stateKey: 'x' }] });
  store.seedSpool({ tenantId: 'tenant-1', digestKey: 'good', status: 'open', windowStart: '2026-01-01T00:00:00.000Z', windowEnd: '2026-01-01T00:00:00.000Z', items: [{ stateKey: 'y', transition: 'new', snapshot: { label: 'Good', deltaPct: -10 } }] });

  const originalFind = store.findOpenSpool.bind(store);
  store.findOpenSpool = async (tenantId, digestKey) => {
    if (digestKey === 'bad') throw new Error('boom');
    return originalFind(tenantId, digestKey);
  };

  const service = createNotificationService({ store, now: () => new Date('2026-01-01T06:00:00.000Z') });
  const result = await service.sweepOpenDigests({ olderThanMs: 0 });
  assert.equal(result.count, 1);
  assert.equal(store.spools.get('tenant-1|good').status, 'flushed');
});
