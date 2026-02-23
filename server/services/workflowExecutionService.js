const Workflow = require('../models/Workflow');
const WorkflowVersion = require('../models/WorkflowVersion');
const WorkflowRun = require('../models/WorkflowRun');
const Insight = require('../models/Insight');
const { pruneWorkflowRuns } = require('../lib/retention');
const WorkflowRunner = require('../../engine/WorkflowRunner');

async function resolveWorkflowVersion({ tenantId, workflowId, version }) {
  let workflow = await Workflow.findOne({ tenantId, workflowId }).lean();
  if (!workflow) {
    workflow = await Workflow.findOne({ scope: 'global', tenantId: null, workflowId }).lean();
  }
  if (!workflow || !workflow.isActive) {
    const err = new Error('workflow not found');
    err.status = 404;
    throw err;
  }

  const versionId = version || workflow.latestVersion;
  const scope = workflow.scope || 'tenant';
  const scopeClause = scope === 'global'
    ? { scope: 'global' }
    : { $or: [{ scope: 'tenant' }, { scope: { $exists: false } }] };

  const workflowVersion = await WorkflowVersion.findOne({
    tenantId: workflow.tenantId ?? null,
    workflowId,
    version: versionId,
    ...scopeClause
  }).lean();

  if (!workflowVersion) {
    const err = new Error('workflow version not found');
    err.status = 404;
    throw err;
  }

  return {
    workflow,
    workflowVersion,
    versionId
  };
}

async function persistFinalInsight({ tenantId, workflowId, runId, context }) {
  const finalInsight = context?.scratch?.finalInsight;
  if (!finalInsight) return;

  await Insight.create({
    tenantId,
    workflowId,
    runId,
    summary: finalInsight.summary || 'unknown',
    details: finalInsight.details || [],
    confidence: finalInsight.confidence
  });
}

async function executeRun({ run, runId }) {
  const targetRun = run || await WorkflowRun.findById(runId);
  if (!targetRun) {
    throw new Error('run not found');
  }

  const nodeOutputs = [];
  const runner = new WorkflowRunner(targetRun.definitionJson, {
    onNodeResult: payload => nodeOutputs.push(payload)
  });

  const startedAt = targetRun.startedAt || new Date();

  try {
    const result = await runner.executeWorkflow(targetRun.context);

    targetRun.status = result.status;
    targetRun.context = result.context;
    targetRun.metrics = result.context?.metrics;
    targetRun.executionTrace = result.context?.executionTrace || [];
    targetRun.nodeOutputs = nodeOutputs;
    targetRun.startedAt = startedAt;
    targetRun.finishedAt = new Date();
    targetRun.lastError = undefined;

    await targetRun.save();

    await persistFinalInsight({
      tenantId: targetRun.tenantId,
      workflowId: targetRun.workflowId,
      runId: targetRun._id,
      context: result.context
    });

    const removedRunIds = await pruneWorkflowRuns(
      WorkflowRun,
      targetRun.tenantId,
      targetRun.workflowId,
      4
    );

    if (removedRunIds.length) {
      await Insight.deleteMany({ runId: { $in: removedRunIds } });
    }

    return targetRun;
  } catch (error) {
    targetRun.status = 'failed';
    targetRun.startedAt = startedAt;
    targetRun.finishedAt = new Date();
    targetRun.lastError = error.message;
    await targetRun.save();
    throw error;
  }
}

module.exports = {
  resolveWorkflowVersion,
  executeRun
};
