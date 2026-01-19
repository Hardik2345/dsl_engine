async function ValidationNode(def, context) {
  const { tenantId, metric, window, baselineWindow } = context.meta || {};

  // Check weather the tenant id exists in our system or not
  if (!tenantId || typeof tenantId !== 'string') {
    return {
      status: 'fail',
      reason: 'Invalid or missing tenantId in context.meta'
    };
  }

  if (!metric || typeof metric !== 'string') {
    return {
      status: 'fail',
      reason: 'Invalid or missing metric in context.meta'
    };
  }

  if (!window || !window.start || !window.end) {
    return {
      status: 'fail',
      reason: 'Invalid or missing window in context.meta'
    };
  }

  const hasBaseline =
    baselineWindow && baselineWindow.start && baselineWindow.end;

  return {
    status: 'pass',
    delta: {
      metrics: {
        data_valid: true,
        baseline_available: !!hasBaseline
      }
    },
    next: def.next
  };
}

module.exports = ValidationNode;
