const express = require('express');
const Workflow = require('../models/Workflow');
const WorkflowVersion = require('../models/WorkflowVersion');
const WorkflowRun = require('../models/WorkflowRun');
const Insight = require('../models/Insight');
const { validateRunContext } = require('../validation/runContext');
const { pruneWorkflowRuns } = require('../lib/retention');
const WorkflowRunner = require('../../engine/WorkflowRunner');

const router = express.Router({ mergeParams: true });

router.post('/:workflowId/runs', async (req, res, next) => {
  try {
    const { tenantId, workflowId } = req.params;
    const { version, context } = req.body || {};

    const { ok, errors } = validateRunContext(context);
    if (!ok) return res.status(400).json({ errors });
    if (context.meta.tenantId !== tenantId) {
      return res.status(400).json({ error: 'tenantId mismatch in context' });
    }

    let workflow = await Workflow.findOne({ tenantId, workflowId }).lean();
    if (!workflow) {
      workflow = await Workflow.findOne({ scope: 'global', tenantId: null, workflowId }).lean();
    }
    if (!workflow) return res.status(404).json({ error: 'workflow not found' });

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
      return res.status(404).json({ error: 'workflow version not found' });
    }

    const nodeOutputs = [];
    const runner = new WorkflowRunner(workflowVersion.definitionJson, {
      onNodeResult: payload => nodeOutputs.push(payload)
    });

    const startedAt = new Date();
    const result = await runner.executeWorkflow(context);
    const finishedAt = new Date();

    const run = await WorkflowRun.create({
      tenantId,
      workflowId,
      version: versionId,
      status: result.status,
      context: result.context,
      metrics: result.context?.metrics,
      executionTrace: result.context?.executionTrace || [],
      nodeOutputs,
      startedAt,
      finishedAt
    });

    const finalInsight = result.context?.scratch?.finalInsight;
    if (finalInsight) {
      await Insight.create({
        tenantId,
        workflowId,
        runId: run._id,
        summary: finalInsight.summary || 'unknown',
        details: finalInsight.details || [],
        confidence: finalInsight.confidence
      });
    }

    const removedRunIds = await pruneWorkflowRuns(WorkflowRun, tenantId, workflowId, 4);
    if (removedRunIds.length) {
      await Insight.deleteMany({ runId: { $in: removedRunIds } });
    }

    res.status(201).json({ runId: run._id, status: run.status });
  } catch (err) {
    next(err);
  }
});

router.get('/:workflowId/runs', async (req, res, next) => {
  try {
    const { tenantId, workflowId } = req.params;
    const runs = await WorkflowRun.find({ tenantId, workflowId })
      .sort({ startedAt: -1 })
      .limit(20)
      .lean();
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});

router.get('/:workflowId/runs/:runId', async (req, res, next) => {
  try {
    const { tenantId, workflowId, runId } = req.params;
    const run = await WorkflowRun.findOne({ _id: runId, tenantId, workflowId }).lean();
    if (!run) return res.status(404).json({ error: 'run not found' });
    res.json({ run });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
