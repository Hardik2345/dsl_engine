export function getWorkflowKind(workflow = {}) {
  if (workflow.workflowKind) return workflow.workflowKind;
  if (workflow.scope === 'global') return 'global';
  if (Array.isArray(workflow.tenantIds) && workflow.tenantIds.length > 1) return 'multi_tenant';
  return 'single_tenant';
}

export function getWorkflowKindLabel(workflow = {}) {
  const kind = getWorkflowKind(workflow);
  if (kind === 'global') return 'Global';
  if (kind === 'multi_tenant') return 'Multi Tenant';
  return 'Single Tenant';
}

export function getWorkflowKindStatus(workflow = {}) {
  const kind = getWorkflowKind(workflow);
  if (kind === 'global') return 'global';
  if (kind === 'multi_tenant') return 'multi_tenant';
  return 'single_tenant';
}
