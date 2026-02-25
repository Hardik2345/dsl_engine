async function WorkflowRefNode(def, context, runtime) {
  if (!runtime || typeof runtime.executeWorkflowReference !== 'function') {
    return {
      status: 'fail',
      reason: 'WorkflowRefNode: runtime execution helper is not available'
    };
  }

  if (!def?.ref || typeof def.ref !== 'object') {
    return {
      status: 'fail',
      reason: 'WorkflowRefNode: ref is required'
    };
  }

  const nestedResult = await runtime.executeWorkflowReference(def, context);

  if (nestedResult?.status === 'terminated') {
    return {
      status: 'terminated',
      reason: nestedResult.reason,
      context: nestedResult.context
    };
  }

  if (!nestedResult || nestedResult.status !== 'completed') {
    return {
      status: 'fail',
      reason: nestedResult?.reason || 'WorkflowRefNode: referenced workflow failed'
    };
  }

  return {
    status: 'pass',
    next: def.next
  };
}

module.exports = WorkflowRefNode;
