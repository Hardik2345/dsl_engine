const {
  parseSqlDateTime,
  isHourAligned,
  hasPositiveDuration,
} = require('../../lib/timeWindowUtils');

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

    const ranges = [
      { label: 'window', value: window },
      { label: 'baselineWindow', value: baselineWindow }
    ];

    for (const range of ranges) {
      const start = range.value?.start;
      const end = range.value?.end;
      if (!start || !end) continue;

      if (!parseSqlDateTime(start) || !parseSqlDateTime(end)) {
        errors.push(`context.meta.${range.label}.start/end must be valid SQL datetime strings`);
        continue;
      }

      if (!isHourAligned(start) || !isHourAligned(end)) {
        errors.push(
          `context.meta.${range.label}.start/end must be aligned to the hour (minutes and seconds must be 00)`
        );
      }

      if (!hasPositiveDuration(start, end)) {
        errors.push(`context.meta.${range.label}.end must be after start`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { validateRunContext };
