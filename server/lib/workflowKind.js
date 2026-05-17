function getWorkflowKind(workflow = {}) {
  if ((workflow.scope || 'tenant') === 'global') return 'global';
  if (Array.isArray(workflow.tenantIds) && workflow.tenantIds.length > 1) return 'multi_tenant';
  return 'single_tenant';
}

function attachWorkflowKind(workflow) {
  if (!workflow) return workflow;
  return {
    ...workflow,
    workflowKind: getWorkflowKind(workflow)
  };
}

function attachWorkflowKinds(workflows = []) {
  return workflows.map(attachWorkflowKind);
}

module.exports = {
  getWorkflowKind,
  attachWorkflowKind,
  attachWorkflowKinds
};
