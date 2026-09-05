const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RUN_LEASE_MS,
  LEASE_HEARTBEAT_MS,
  startLeaseHeartbeat
} = require('../scheduler/app/runQueueService');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('lease is long enough to be renewed several times before it expires', () => {
  assert.ok(
    LEASE_HEARTBEAT_MS * 3 <= RUN_LEASE_MS,
    `heartbeat ${LEASE_HEARTBEAT_MS}ms must fit at least three times into lease ${RUN_LEASE_MS}ms`
  );
});

test('heartbeat keeps renewing the lease while a run executes', async () => {
  const renewals = [];
  const heartbeat = startLeaseHeartbeat({
    runId: 'run-1',
    workerId: 'worker-1',
    leaseMs: 5000,
    intervalMs: 10,
    renew: async (runId, workerId, leaseMs) => {
      renewals.push({ runId, workerId, leaseMs });
      return { _id: runId };
    }
  });

  await wait(60);
  await heartbeat.stop();

  assert.ok(renewals.length >= 3, `expected repeated renewals, got ${renewals.length}`);
  assert.deepEqual(renewals[0], { runId: 'run-1', workerId: 'worker-1', leaseMs: 5000 });
});

test('stop() halts renewals so a finished run does not hold its lease', async () => {
  let renewals = 0;
  const heartbeat = startLeaseHeartbeat({
    runId: 'run-2',
    workerId: 'worker-1',
    intervalMs: 10,
    renew: async () => {
      renewals += 1;
      return { _id: 'run-2' };
    }
  });

  await wait(40);
  await heartbeat.stop();
  const afterStop = renewals;

  await wait(40);
  assert.equal(renewals, afterStop, 'no renewals should happen after stop()');
});

test('heartbeat gives up once the lease is no longer held', async () => {
  let renewals = 0;
  const heartbeat = startLeaseHeartbeat({
    runId: 'run-3',
    workerId: 'worker-1',
    intervalMs: 10,
    renew: async () => {
      renewals += 1;
      return null; // another worker owns the run, or it already finished
    }
  });

  await wait(60);
  const observed = renewals;
  await heartbeat.stop();

  assert.equal(observed, 1, 'should stop after the first failed renewal');
});

test('heartbeat survives a transient renewal error', async () => {
  let renewals = 0;
  const heartbeat = startLeaseHeartbeat({
    runId: 'run-4',
    workerId: 'worker-1',
    intervalMs: 10,
    renew: async () => {
      renewals += 1;
      if (renewals === 1) throw new Error('mongo unavailable');
      return { _id: 'run-4' };
    }
  });

  await wait(60);
  await heartbeat.stop();

  assert.ok(renewals >= 3, `heartbeat should retry after an error, got ${renewals}`);
});
