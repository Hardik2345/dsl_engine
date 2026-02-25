const Workflow = require('../models/Workflow');
const WorkflowVersion = require('../models/WorkflowVersion');

function workflowNotFoundError(message = 'workflow not found') {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function workflowVersionNotFoundError(message = 'workflow version not found') {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function workflowInactiveError(message = 'workflow is inactive') {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function scopeMismatchError(message = 'workflow scope mismatch') {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function buildVersionScopeClause(scope) {
  return scope === 'global'
    ? { scope: 'global' }
    : { $or: [{ scope: 'tenant' }, { scope: { $exists: false } }] };
}

function normalizeWorkflowIdentity(workflow, versionId) {
  const scope = workflow.scope || 'tenant';
  const tenantScope = scope === 'global' ? 'global' : (workflow.tenantId || 'tenant');
  return `${tenantScope}/${workflow.workflowId}@${versionId}`;
}

async function resolveWorkflowRecord({
  tenantId,
  workflowId,
  preferredScope,
  allowGlobalFallback = true,
  allowedScopes = ['tenant', 'global'],
}) {
  if (!workflowId) {
    throw workflowNotFoundError('workflowId is required');
  }

  const canUseTenant = allowedScopes.includes('tenant');
  const canUseGlobal = allowedScopes.includes('global');

  let workflow = null;

  if (preferredScope) {
    if (!allowedScopes.includes(preferredScope)) {
      throw scopeMismatchError(`workflow scope '${preferredScope}' is not allowed`);
    }
    if (preferredScope === 'tenant') {
      workflow = canUseTenant ? await Workflow.findOne({ tenantId, workflowId }).lean() : null;
    } else if (preferredScope === 'global') {
      workflow = canUseGlobal
        ? await Workflow.findOne({ scope: 'global', tenantId: null, workflowId }).lean()
        : null;
    }
    if (!workflow) {
      throw workflowNotFoundError();
    }
  } else {
    if (canUseTenant) {
      workflow = await Workflow.findOne({ tenantId, workflowId }).lean();
    }
    if (!workflow && allowGlobalFallback && canUseGlobal) {
      workflow = await Workflow.findOne({ scope: 'global', tenantId: null, workflowId }).lean();
    }
    if (!workflow) {
      throw workflowNotFoundError();
    }
  }

  if (!workflow.isActive) {
    throw workflowInactiveError();
  }

  return workflow;
}

async function resolveWorkflowVersion({
  tenantId,
  workflowId,
  version,
  preferredScope,
  allowGlobalFallback = true,
  allowedScopes = ['tenant', 'global'],
}) {
  const workflow = await resolveWorkflowRecord({
    tenantId,
    workflowId,
    preferredScope,
    allowGlobalFallback,
    allowedScopes,
  });

  const versionId = version || workflow.latestVersion;
  const scope = workflow.scope || 'tenant';
  const scopeClause = buildVersionScopeClause(scope);

  const workflowVersion = await WorkflowVersion.findOne({
    tenantId: workflow.tenantId ?? null,
    workflowId,
    version: versionId,
    ...scopeClause,
  }).lean();

  if (!workflowVersion) {
    throw workflowVersionNotFoundError();
  }

  return {
    workflow,
    workflowVersion,
    versionId,
    identity: normalizeWorkflowIdentity(workflow, versionId),
  };
}

async function resolveWorkflowReference({ tenantId, ref }) {
  const workflowId = ref?.workflow_id;
  const version = ref?.version;
  const preferredScope = ref?.scope;

  if (!workflowId) {
    const err = new Error('workflow_ref.ref.workflow_id is required');
    err.status = 400;
    throw err;
  }

  if (!version) {
    const err = new Error('workflow_ref.ref.version is required');
    err.status = 400;
    throw err;
  }

  return resolveWorkflowVersion({
    tenantId,
    workflowId,
    version,
    preferredScope,
    allowGlobalFallback: preferredScope !== 'tenant',
    allowedScopes: ['tenant', 'global'],
  });
}

module.exports = {
  resolveWorkflowVersion,
  resolveWorkflowReference,
  normalizeWorkflowIdentity,
};
