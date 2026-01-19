function validateRunContext(context) {
  const errors = [];

  if (!context || typeof context !== 'object') {
    return { ok: false, errors: ['context must be an object'] };
  }

  if (!context.meta || typeof context.meta !== 'object') {
    errors.push('context.meta is required');
  } else {
    const { tenantId, window, baselineWindow } = context.meta;
    if (!tenantId) errors.push('context.meta.tenantId is required');
    if (!window?.start || !window?.end) errors.push('context.meta.window.start/end required');
    if (!baselineWindow?.start || !baselineWindow?.end) {
      errors.push('context.meta.baselineWindow.start/end required');
    }
    if (baselineWindow?.type) {
      errors.push('context.meta.baselineWindow.type is not allowed');
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { validateRunContext };
