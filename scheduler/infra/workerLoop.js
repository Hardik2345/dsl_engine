const {
  claimNextRunnableRun,
  claimRunById,
  promoteDeferredRun,
  republishDueRetryRuns,
  bootstrapDispatchRunnableRuns
} = require('../app/runQueueService');
const { executeRun } = require('../../server/services/workflowExecutionService');
const { getRetryDelayMs } = require('../domain/retryPolicy');
const { getRabbitWorkflowRunQueue } = require('./runQueue/RabbitWorkflowRunQueue');

async function processOne(workerId) {
  const run = await claimNextRunnableRun(workerId, 30000);
  if (!run) return null;
  return processClaimedRun(run);
}

async function processClaimedRun(run) {
  if (!run) return null;

  try {
    await executeRun({ run });
    await promoteDeferredRun(run.tenantId, run.workflowId, run.executionKey);
    return { runId: run._id, status: 'completed' };
  } catch (error) {
    const delayMs = getRetryDelayMs(
      { maxAttempts: run.maxAttempts || 3, backoffSeconds: [30, 120, 600] },
      run.attempt
    );

    if (delayMs === null) {
      run.status = 'dead_letter';
      run.finishedAt = new Date();
      run.lastError = error.message;
      await run.save();
      await promoteDeferredRun(run.tenantId, run.workflowId, run.executionKey);
      return { runId: run._id, status: 'dead_letter' };
    }

    run.status = 'retrying';
    run.nextRetryAt = new Date(Date.now() + delayMs);
    run.lastError = error.message;
    run.finishedAt = null;
    await run.save();
    return { runId: run._id, status: 'retrying' };
  }
}

function useRabbitRunQueue() {
  return process.env.SCHEDULER_RUN_QUEUE_BACKEND === 'rabbit';
}

async function runLoopMongo({ workerId, intervalMs = 2000, stopSignal }) {
  while (!stopSignal.stopped) {
    try {
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

  const retryTickMs = Number(process.env.SCHEDULER_RETRY_TICK_MS || 2000);
  const retryTimer = setInterval(async () => {
    try {
      await republishDueRetryRuns();
    } catch (error) {
      console.error('[scheduler-worker] retry republish failed', error.message);
    }
  }, retryTickMs);

  try {
    await queue.consumeRuns({
      stopSignal,
      handler: async ({ runId }) => {
        const run = await claimRunById(runId, workerId, 30000);
        if (!run) {
          return;
        }
        await processClaimedRun(run);
      }
    });
  } finally {
    clearInterval(retryTimer);
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
