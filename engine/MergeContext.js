function mergeContext(context, delta = {}) {
  if (!delta) return context;

  // 1. Meta is immutable
  if (delta.meta) {
    throw new Error('meta is immutable and cannot be merged');
  }

  // 2. Append filters
  if (Array.isArray(delta.filters)) {
    context.filters.push(...delta.filters);
  }

  // 3. Merge metrics
  if (delta.metrics) {
    context.metrics = {
      ...context.metrics,
      ...delta.metrics
    };
  }

  // 4. Append root cause path
  if (Array.isArray(delta.rootCausePath)) {
    context.rootCausePath.push(...delta.rootCausePath);
  }

  // 5. Overwrite scratch
  if (delta.scratch) {
    context.scratch = delta.scratch;
  }

  // 6. Merge breakdowns
  if (delta.breakdowns) {
    context.breakdowns = context.breakdowns || {};

    Object.entries(delta.breakdowns).forEach(([dimension, evidence]) => {
      context.breakdowns[dimension] = (
        context.breakdowns[dimension] || []
      ).concat(evidence);
    });
  }

  return context;
}

module.exports = mergeContext;
