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

  // 6. Store breakdown outputs by key.
  // Each node returns the complete list for an output key, so appending here
  // leaks stale evidence on reruns and makes email tables disagree with the
  // latest metric output. A later writer to the same key is authoritative.
  if (delta.breakdowns) {
    context.breakdowns = context.breakdowns || {};

    Object.entries(delta.breakdowns).forEach(([dimension, evidence]) => {
      context.breakdowns[dimension] = Array.isArray(evidence) ? evidence : [];
    });
  }

  return context;
}

module.exports = mergeContext;
