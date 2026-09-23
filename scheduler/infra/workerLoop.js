const {
  claimNextRunnableRun,
  claimRunById,
  startLeaseHeartbeat,
  promoteDeferredRun,
  republishDueRetryRuns,
  bootstrapDispatchRunnableRuns,
  recoverExpiredRunningRuns
} = require('../app/runQueueService');
const { executeRun } = require('../../server/services/workflowExecutionService');
const { getRetryDelayMs } = require('../domain/retryPolicy');
const { getRabbitWorkflowRunQueue } = require('./runQueue/RabbitWorkflowRunQueue');
const { sweepOpenDigests, sweepPendingDeliveries, sweepStaleFindings } = require('../../server/services/notificationService');

const DIGEST_SWEEP_TICK_MS = Number(process.env.NOTIFY_DIGEST_SWEEP_TICK_MS || 60000);
// Gap #2: this is now the real send path (the per-run pipeline only writes a
// pending row), so it runs much more often than the digest sweep.
const PENDING_SWEEP_TICK_MS = Number(process.env.NOTIFY_PENDING_SWEEP_TICK_MS || 15000);
// Staleness is inherently slow-moving -- a coarse tick is fine and avoids
// hammering AlertState/Workflow lookups for something that changes over hours/days.
const STALE_SWEEP_TICK_MS = Number(process.env.NOTIFY_STALE_SWEEP_TICK_MS || 15 * 60 * 1000);

async function processOne(workerId) {
  const run = await claimNextRunnableRun(workerId);
  if (!run) return null;
  const workflowName = run.definitionJson?.name || 'unknown';
  console.log(`[scheduler-worker] claimed run=${run._id} workflow=${run.workflowId} workflowName="${workflowName}" tenant=${run.tenantId} attempt=${(run.attempt || 0) + 1}/${run.maxAttempts || 3} backend=mongo`);
  return processClaimedRun(run);
}

async function processClaimedRun(run) {
  if (!run) return null;

  const heartbeat = startLeaseHeartbeat({
    runId: run._id,
    workerId: run.leaseOwner
  });

  try {
    const workflowName = run.definitionJson?.name || 'unknown';
    console.log(`[scheduler-worker] executing run=${run._id} workflow=${run.workflowId} workflowName="${workflowName}" tenant=${run.tenantId} trigger=${run.triggerType || 'unknown'} attempt=${run.attempt}/${run.maxAttempts || 3}`);
    await executeRun({ run });
    console.log(`[scheduler-worker] completed run=${run._id} workflow=${run.workflowId} workflowName="${workflowName}" status=${run.status}`);
    await promoteDeferredRun(run.tenantId, run.workflowId, run.executionKey);
    return { runId: run._id, status: 'completed' };
  } catch (error) {
    const workflowName = run.definitionJson?.name || 'unknown';
    console.error(`[scheduler-worker] execution failed run=${run._id} workflow=${run.workflowId} workflowName="${workflowName}" attempt=${run.attempt}/${run.maxAttempts || 3} error=${error.message}`);
    const delayMs = getRetryDelayMs(
      { maxAttempts: run.maxAttempts || 3, backoffSeconds: [30, 120, 600] },
      run.attempt
    );

    if (delayMs === null) {
      run.status = 'dead_letter';
      run.finishedAt = new Date();
      run.lastError = error.message;
      run.leaseOwner = null;
      run.leaseExpiresAt = null;
      await run.save();
      console.error(`[scheduler-worker] dead-lettered run=${run._id} workflow=${run.workflowId} workflowName="${workflowName}" lastError=${run.lastError}`);
      await promoteDeferredRun(run.tenantId, run.workflowId, run.executionKey);
      return { runId: run._id, status: 'dead_letter' };
    }

    run.status = 'retrying';
    run.nextRetryAt = new Date(Date.now() + delayMs);
    run.lastError = error.message;
    run.finishedAt = null;
    run.leaseOwner = null;
    run.leaseExpiresAt = null;
    await run.save();
    console.warn(`[scheduler-worker] scheduled retry run=${run._id} workflow=${run.workflowId} workflowName="${workflowName}" nextRetryAt=${run.nextRetryAt.toISOString()} delayMs=${delayMs}`);
    return { runId: run._id, status: 'retrying' };
  } finally {
    await heartbeat.stop();
  }
}

function useRabbitRunQueue() {
  return process.env.SCHEDULER_RUN_QUEUE_BACKEND === 'rabbit';
}

async function runLoopMongo({ workerId, intervalMs = 2000, stopSignal }) {
  // No independent timer exists on this backend (unlike runLoopRabbit's retry
  // timer), so each sweep is interleaved into this sequential loop instead --
  // checked once per iteration rather than run on every single iteration.
  let lastDigestSweepAt = 0;
  let lastPendingSweepAt = 0;
  let lastStaleSweepAt = 0;

  while (!stopSignal.stopped) {
    try {
      await recoverExpiredRunningRuns();

      if (Date.now() - lastPendingSweepAt >= PENDING_SWEEP_TICK_MS) {
        lastPendingSweepAt = Date.now();
        try {
          await sweepPendingDeliveries();
        } catch (error) {
          console.error('[notify] pending delivery sweep failed', error.message);
        }
      }

      if (Date.now() - lastDigestSweepAt >= DIGEST_SWEEP_TICK_MS) {
        lastDigestSweepAt = Date.now();
        try {
          await sweepOpenDigests();
        } catch (error) {
          console.error('[notify] digest sweep failed', error.message);
        }
      }

      if (Date.now() - lastStaleSweepAt >= STALE_SWEEP_TICK_MS) {
        lastStaleSweepAt = Date.now();
        try {
          await sweepStaleFindings();
        } catch (error) {
          console.error('[notify] stale sweep failed', error.message);
        }
      }

      const result = await processOne(workerId);
      if (!result) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    } catch (error) {
      console.error('[scheduler-worker] iteration failed', error);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
}

async function runLoopRabbit({ workerId, intervalMs = 2000, stopSignal }) {
  const queue = getRabbitWorkflowRunQueue();

  // Best-effort recovery: re-dispatch runnable DB-backed runs when worker starts.
  await bootstrapDispatchRunnableRuns();
  await recoverExpiredRunningRuns();

  const retryTickMs = Number(process.env.SCHEDULER_RETRY_TICK_MS || 2000);
  const retryTimer = setInterval(async () => {
    try {
      await recoverExpiredRunningRuns();
      await republishDueRetryRuns();
    } catch (error) {
      console.error('[scheduler-worker] retry republish failed', error.message);
    }
  }, retryTickMs);

  // Piggybacks on the existing retry timer's own throttle rather than adding a
  // separate setInterval per sweep -- this backend already has a periodic tick,
  // matching the design's §8.4 "loop hung off the existing worker tick."
  let lastDigestSweepAt = 0;
  let lastPendingSweepAt = 0;
  let lastStaleSweepAt = 0;
  const notifySweepTimer = setInterval(async () => {
    if (Date.now() - lastPendingSweepAt >= PENDING_SWEEP_TICK_MS) {
      lastPendingSweepAt = Date.now();
      try {
        await sweepPendingDeliveries();
      } catch (error) {
        console.error('[notify] pending delivery sweep failed', error.message);
      }
    }
    if (Date.now() - lastDigestSweepAt >= DIGEST_SWEEP_TICK_MS) {
      lastDigestSweepAt = Date.now();
      try {
        await sweepOpenDigests();
      } catch (error) {
        console.error('[notify] digest sweep failed', error.message);
      }
    }
    if (Date.now() - lastStaleSweepAt >= STALE_SWEEP_TICK_MS) {
      lastStaleSweepAt = Date.now();
      try {
        await sweepStaleFindings();
      } catch (error) {
        console.error('[notify] stale sweep failed', error.message);
      }
    }
  }, Math.min(retryTickMs, PENDING_SWEEP_TICK_MS));

  try {
    await queue.consumeRuns({
      stopSignal,
      handler: async ({ runId }) => {
        const run = await claimRunById(runId, workerId);
        if (!run) {
          console.log(`[scheduler-worker] skipped rabbit message run=${runId} reason=not_claimable_or_missing`);
          return;
        }
        const workflowName = run.definitionJson?.name || 'unknown';
        console.log(`[scheduler-worker] claimed run=${run._id} workflow=${run.workflowId} workflowName="${workflowName}" tenant=${run.tenantId} attempt=${run.attempt}/${run.maxAttempts || 3} backend=rabbit`);
        await processClaimedRun(run);
      }
    });
  } finally {
    clearInterval(retryTimer);
    clearInterval(notifySweepTimer);
    await queue.close();
  }
}

async function runLoop({ workerId, intervalMs = 2000, stopSignal }) {
  if (useRabbitRunQueue()) {
    return runLoopRabbit({ workerId, intervalMs, stopSignal });
  }
  return runLoopMongo({ workerId, intervalMs, stopSignal });
}

module.exports = {
  runLoop,
  processOne,
  processClaimedRun
};
