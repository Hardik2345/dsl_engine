const mongoose = require('mongoose');
const WorkflowRun = require('../../server/models/WorkflowRun');
const { ACTIVE_STATUSES, PENDING_STATUSES, evaluateOverlap } = require('../domain/overlapPolicy');
const { getRabbitWorkflowRunQueue } = require('../infra/runQueue/RabbitWorkflowRunQueue');
const { getRetryDelayMs } = require('../domain/retryPolicy');

function useRabbitRunQueue() {
  return process.env.SCHEDULER_RUN_QUEUE_BACKEND === 'rabbit';
}

function getExecutionKey({ tenantId, workflowId }) {
  return `${tenantId}:${workflowId}`;
}

async function enqueueRun(params) {
  const {
    tenantId,
    workflowId,
    version,
    context,
    definitionJson,
    triggerType = 'manual',
    triggerRef = null,
    overlapPolicy = 'queue_one_pending',
    maxAttempts = 3
  } = params;

  const executionKey = getExecutionKey({ tenantId, workflowId });

  const [activeRun, pendingRun] = await Promise.all([
    WorkflowRun.findOne({
      tenantId,
      workflowId,
      executionKey,
      status: { $in: Array.from(ACTIVE_STATUSES) }
    }).sort({ createdAt: 1 }),
    WorkflowRun.findOne({
      tenantId,
      workflowId,
      executionKey,
      status: { $in: Array.from(PENDING_STATUSES) }
    }).sort({ createdAt: 1 })
  ]);

  const overlapDecision = evaluateOverlap({ activeRun, pendingRun, overlapPolicy });
  if (overlapDecision.action === 'skip') {
    return {
      enqueued: false,
      reason: overlapDecision.reason,
      run: null
    };
  }

  const status = overlapDecision.action === 'defer' ? 'deferred' : 'queued';
  const now = new Date();
  const run = await WorkflowRun.create({
    tenantId,
    workflowId,
    version,
    status,
    triggerType,
    triggerRef,
    executionKey,
    context,
    definitionJson,
    metrics: context?.metrics || {},
    executionTrace: context?.executionTrace || [],
    nodeOutputs: [],
    queuedAt: now,
    maxAttempts,
    attempt: 0,
    startedAt: now
  });

  console.log(`[run-queue] created run=${run._id} workflow=${workflowId} tenant=${tenantId} status=${status} trigger=${triggerType}`);

  if (status === 'queued' && useRabbitRunQueue()) {
    console.log(`[run-queue] dispatching run=${run._id} via rabbit exchange=${process.env.RABBITMQ_RUN_EXCHANGE || 'scheduler.runs'} routingKey=${process.env.RABBITMQ_RUN_ROUTING_KEY || 'workflow.run'}`);
    await getRabbitWorkflowRunQueue().publishRun(run._id, {
      triggerType,
      tenantId,
      workflowId
    });
  }

  return {
    enqueued: true,
    reason: null,
    run
  };
}

async function claimNextRunnableRun(workerId, leaseMs = 30000) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  return WorkflowRun.findOneAndUpdate(
    {
      status: { $in: ['queued', 'retrying'] },
      $or: [
        { nextRetryAt: { $exists: false } },
        { nextRetryAt: null },
        { nextRetryAt: { $lte: now } }
      ]
    },
    {
      $set: {
        status: 'running',
        leaseOwner: workerId,
        leaseExpiresAt,
        startedAt: now
      },
      $inc: { attempt: 1 }
    },
    {
      sort: { queuedAt: 1, createdAt: 1 },
      new: true
    }
  );
}

async function claimRunById(runId, workerId, leaseMs = 30000) {
  if (!mongoose.Types.ObjectId.isValid(runId)) {
    const err = new Error(`invalid runId: ${runId}`);
    err.code = 'INVALID_RUN_MESSAGE';
    throw err;
  }

  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  return WorkflowRun.findOneAndUpdate(
    {
      _id: runId,
      status: { $in: ['queued', 'retrying'] },
      $or: [
        { nextRetryAt: { $exists: false } },
        { nextRetryAt: null },
        { nextRetryAt: { $lte: now } }
      ]
    },
    {
      $set: {
        status: 'running',
        leaseOwner: workerId,
        leaseExpiresAt,
        startedAt: now
      },
      $inc: { attempt: 1 }
    },
    { new: true }
  );
}

async function promoteDeferredRun(tenantId, workflowId, executionKey) {
  const active = await WorkflowRun.findOne({
    tenantId,
    workflowId,
    executionKey,
    status: { $in: Array.from(ACTIVE_STATUSES) }
  }).lean();

  if (active) return null;

  const promoted = await WorkflowRun.findOneAndUpdate(
    {
      tenantId,
      workflowId,
      executionKey,
      status: 'deferred'
    },
    {
      $set: {
        status: 'queued',
        queuedAt: new Date()
      }
    },
    {
      sort: { createdAt: 1 },
      new: true
    }
  );

  if (promoted && useRabbitRunQueue()) {
    console.log(`[run-queue] promoted deferred run=${promoted._id} workflow=${workflowId} tenant=${tenantId} -> queued; dispatching via rabbit`);
    await getRabbitWorkflowRunQueue().publishRun(promoted._id, {
      triggerType: promoted.triggerType || 'unknown',
      tenantId,
      workflowId
    });
  }

  return promoted;
}

async function publishRunDispatch(runId, headers = {}) {
  if (!useRabbitRunQueue()) return;
  await getRabbitWorkflowRunQueue().publishRun(runId, headers);
}

async function republishDueRetryRuns(limit = 100) {
  if (!useRabbitRunQueue()) return { count: 0 };

  const now = new Date();
  const due = await WorkflowRun.find({
    status: 'retrying',
    nextRetryAt: { $lte: now }
  })
    .sort({ nextRetryAt: 1 })
    .limit(limit)
    .select('_id tenantId workflowId triggerType')
    .lean();

  for (const run of due) {
    console.log(`[run-queue] re-dispatch retry run=${run._id} workflow=${run.workflowId} tenant=${run.tenantId}`);
    await publishRunDispatch(run._id, {
      triggerType: run.triggerType || 'retry',
      tenantId: run.tenantId,
      workflowId: run.workflowId,
      retry: true
    });
  }

  return { count: due.length };
}

async function bootstrapDispatchRunnableRuns(limit = 500) {
  if (!useRabbitRunQueue()) return { count: 0 };

  const now = new Date();
  const runs = await WorkflowRun.find({
    $or: [
      { status: 'queued' },
      { status: 'retrying', nextRetryAt: { $lte: now } }
    ]
  })
    .sort({ queuedAt: 1, createdAt: 1 })
    .limit(limit)
    .select('_id tenantId workflowId triggerType')
    .lean();

  for (const run of runs) {
    console.log(`[run-queue] bootstrap dispatch run=${run._id} workflow=${run.workflowId} tenant=${run.tenantId} status=${run.status}`);
    await publishRunDispatch(run._id, {
      triggerType: run.triggerType || 'unknown',
      tenantId: run.tenantId,
      workflowId: run.workflowId,
      bootstrap: true
    });
  }

  return { count: runs.length };
}

async function recoverExpiredRunningRuns(limit = 100) {
  const now = new Date();
  const recovered = [];

  for (let i = 0; i < limit; i += 1) {
    const claimedExpired = await WorkflowRun.findOneAndUpdate(
      {
        status: 'running',
        leaseExpiresAt: { $lte: now }
      },
      {
        $set: {
          status: 'recovering'
        }
      },
      {
        sort: { leaseExpiresAt: 1, createdAt: 1 },
        new: false
      }
    );

    if (!claimedExpired) break;

    const workflowName = claimedExpired.definitionJson?.name || 'unknown';
    const delayMs = getRetryDelayMs(
      { maxAttempts: claimedExpired.maxAttempts || 3, backoffSeconds: [30, 120, 600] },
      claimedExpired.attempt || 1
    );

    if (delayMs === null) {
      claimedExpired.status = 'dead_letter';
      claimedExpired.finishedAt = now;
      claimedExpired.lastError = 'lease_expired';
      claimedExpired.leaseOwner = null;
      claimedExpired.leaseExpiresAt = null;
      await claimedExpired.save();
      console.warn(`[run-queue] recovered expired lease run=${claimedExpired._id} workflow=${claimedExpired.workflowId} workflowName="${workflowName}" tenant=${claimedExpired.tenantId} -> dead_letter`);
      await promoteDeferredRun(claimedExpired.tenantId, claimedExpired.workflowId, claimedExpired.executionKey);
      recovered.push({ runId: claimedExpired._id, status: 'dead_letter' });
      continue;
    }

    claimedExpired.status = 'retrying';
    claimedExpired.nextRetryAt = new Date(now.getTime() + delayMs);
    claimedExpired.lastError = 'lease_expired';
    claimedExpired.finishedAt = null;
    claimedExpired.leaseOwner = null;
    claimedExpired.leaseExpiresAt = null;
    await claimedExpired.save();
    console.warn(`[run-queue] recovered expired lease run=${claimedExpired._id} workflow=${claimedExpired.workflowId} workflowName="${workflowName}" tenant=${claimedExpired.tenantId} -> retrying nextRetryAt=${claimedExpired.nextRetryAt.toISOString()}`);

    if (useRabbitRunQueue()) {
      await publishRunDispatch(claimedExpired._id, {
        triggerType: claimedExpired.triggerType || 'retry',
        tenantId: claimedExpired.tenantId,
        workflowId: claimedExpired.workflowId,
        recovered: true
      });
    }

    recovered.push({ runId: claimedExpired._id, status: 'retrying' });
  }

  return { count: recovered.length, recovered };
}

module.exports = {
  enqueueRun,
  claimNextRunnableRun,
  claimRunById,
  promoteDeferredRun,
  getExecutionKey,
  publishRunDispatch,
  republishDueRetryRuns,
  bootstrapDispatchRunnableRuns,
  recoverExpiredRunningRuns
};
