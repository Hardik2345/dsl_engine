const WorkflowRun = require('../models/WorkflowRun');
const Insight = require('../models/Insight');
const { pruneWorkflowRuns } = require('../lib/retention');
const WorkflowRunner = require('../../engine/WorkflowRunner');
const workflowResolverService = require('./workflowResolverService');
const Tenant = require('../models/Tenant');
const { runNotificationContext } = require('./emailService');
const { shadowObserve, enforceObserve, createMongoAlertStore } = require('./notificationService');

const alertStateReader = createMongoAlertStore();

const SHADOW_NOTIFICATIONS_ENABLED = String(process.env.NOTIFY_SHADOW_ENABLED || '').toLowerCase() === 'true';
const ENFORCE_NOTIFICATIONS_ENABLED = String(process.env.NOTIFY_ENFORCE_ENABLED || '').toLowerCase() === 'true';

async function resolveWorkflowVersion({ tenantId, workflowId, version }) {
  return workflowResolverService.resolveWorkflowVersion({
    tenantId,
    workflowId,
    version,
    allowGlobalFallback: true,
    allowedScopes: ['tenant', 'global']
  });
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
  const tenant = await Tenant.findOne({ tenantId: targetRun.tenantId }).lean();
  targetRun.context.meta = targetRun.context.meta || {};
  if (!targetRun.context.meta.brandName && tenant?.name) {
    targetRun.context.meta.brandName = tenant.name;
  }
  if (!targetRun.context.meta.emailBranding && tenant?.settings?.emailBranding) {
    targetRun.context.meta.emailBranding = { ...tenant.settings.emailBranding };
  }
  targetRun.markModified('context');
  const runner = new WorkflowRunner(targetRun.definitionJson, {
    onNodeResult: payload => nodeOutputs.push(payload),
    workflowResolver: workflowResolverService,
    workflowIdentity: `${targetRun.tenantId}/${targetRun.workflowId}@${targetRun.version}`,
    alertStateReader
  });

  const startedAt = targetRun.startedAt || new Date();
  // "Send Daily Insight" workflows are plain scheduled reports, not
  // condition-based alerts -- they must go out every run regardless of content
  // repeating, so the 24h cooldown is skipped for them (retry-duplicate
  // protection still applies to every workflow, alwaysSend or not).
  const alwaysSend = Boolean(targetRun.definitionJson?.always_send);

  try {
    const result = await runNotificationContext(
      { tenantId: targetRun.tenantId, workflowId: targetRun.workflowId, runId: String(targetRun._id), alwaysSend },
      () => runner.executeWorkflow(targetRun.context)
    );

    targetRun.status = result.status;
    targetRun.context = result.context;
    targetRun.metrics = result.context?.metrics;
    targetRun.executionTrace = result.context?.executionTrace || [];
    targetRun.nodeOutputs = nodeOutputs;
    targetRun.startedAt = startedAt;
    targetRun.finishedAt = new Date();
    targetRun.lastError = undefined;
    targetRun.leaseOwner = null;
    targetRun.leaseExpiresAt = null;

    await targetRun.save();

    if (alwaysSend) {
      // Skip the finding/state-machine treatment entirely -- a daily report's
      // breakdown rows (e.g. top/bottom performers) are informational, not
      // "problems" to track, fingerprint, and eventually mark resolved. Its
      // email node already sent (or not) via its own normal node logic above;
      // nothing further to gate here.
      targetRun.notificationStatus = 'always_send';
      targetRun.notificationError = null;
      await targetRun.save();
    } else if (ENFORCE_NOTIFICATIONS_ENABLED) {
      // Phase 2: transitions actually gate delivery. Still must never affect the
      // real run outcome (§11.3) -- delivery failure is surfaced via
      // notificationStatus/notificationError, never by throwing here, so a broken
      // notification never makes an otherwise-successful run eligible for re-queue.
      try {
        const dryRun = targetRun.context?.meta?.notifications?.mode === 'dry_run';
        // The alert_state node is the DSL author's declared policy surface -- its
        // notify_policy must actually reach the pipeline, or a workflow's
        // critical_bypass/cooldown/etc. overrides silently do nothing (design §9.1-9.2).
        const alertStateNodeDef = (targetRun.definitionJson?.nodes || []).find((node) => node.type === 'alert_state');
        // The finding-format email node's `to` is the DSL author's declared
        // recipient list (design §9.3) -- context.meta.notificationRecipients is
        // never populated by anything, so falling back to it alone left every
        // pending delivery with an empty recipient list and a silent send failure.
        const findingEmailNodeDef = (targetRun.definitionJson?.nodes || [])
          .find((node) => node.type === 'email' && node.format === 'finding');
        await enforceObserve({
          run: targetRun, result,
          options: {
            dryRun,
            notifyPolicy: alertStateNodeDef?.notify_policy,
            alertId: targetRun.context?.meta?.alertId,
            recipients: targetRun.context?.meta?.notificationRecipients || findingEmailNodeDef?.to || [],
            brandName: targetRun.context?.meta?.brandName,
            branding: targetRun.context?.meta?.emailBranding,
          }
        });
        targetRun.notificationStatus = 'ok';
        targetRun.notificationError = null;
      } catch (error) {
        targetRun.notificationStatus = 'delivery_failed';
        targetRun.notificationError = error.message;
        console.error('[notify] enforceObserve failed', {
          runId: String(targetRun._id), workflowId: targetRun.workflowId, error: error.message
        });
      }
      await targetRun.save();
    } else if (SHADOW_NOTIFICATIONS_ENABLED) {
      // Shadow mode (Phase 1): computes fingerprints/transitions and logs what would
      // happen, but must never affect the real run outcome -- a bug here must not
      // turn a completed run into a failed one.
      try {
        await shadowObserve({ run: targetRun, result });
      } catch (error) {
        console.error('[notify] shadowObserve failed', {
          runId: String(targetRun._id), workflowId: targetRun.workflowId, error: error.message
        });
      }
    }

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
    targetRun.executionTrace = targetRun.context?.executionTrace || [];
    targetRun.nodeOutputs = nodeOutputs;
    targetRun.markModified('context');
    targetRun.startedAt = startedAt;
    targetRun.finishedAt = new Date();
    targetRun.lastError = error.message;
    targetRun.leaseOwner = null;
    targetRun.leaseExpiresAt = null;
    await targetRun.save();
    throw error;
  }
}

module.exports = {
  resolveWorkflowVersion,
  executeRun
};
