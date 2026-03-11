const {
  isPartialDayWindow,
  listHourlyProductUnsupportedFilters,
} = require('../../lib/timeWindowUtils');

function getRecursiveDimensions(node) {
  if (!node || node.type !== 'recursive_dimension_breakdown') return [];
  if (Array.isArray(node.dimensions) && node.dimensions.length) {
    return node.dimensions.filter((dimension) => typeof dimension === 'string' && dimension.trim() !== '');
  }
  if (typeof node.dimension === 'string' && node.dimension.trim() !== '') {
    return [node.dimension];
  }
  return [];
}

function getReachableDepthCount(node, dimensionCount) {
  const maxDepth = Number(node?.stop_conditions?.max_depth);
  if (Number.isInteger(maxDepth) && maxDepth > 0) {
    return Math.min(maxDepth, dimensionCount);
  }
  return Math.min(1, dimensionCount);
}

function getPartialDayProductCompatibilityErrors(definition) {
  if (!definition || typeof definition !== 'object' || !Array.isArray(definition.nodes)) {
    return [];
  }

  const errors = [];

  for (const node of definition.nodes) {
    if (node?.type !== 'recursive_dimension_breakdown') continue;

    const dimensions = getRecursiveDimensions(node);
    if (!dimensions.length) continue;

    const reachableDepthCount = getReachableDepthCount(node, dimensions.length);
    const productIndex = dimensions.indexOf('product_id');
    if (productIndex === -1 || productIndex >= reachableDepthCount || productIndex === 0) {
      continue;
    }

    const precedingDimensions = dimensions.slice(0, productIndex);
    const unsupportedDimensions = precedingDimensions.filter((dimension) => dimension !== 'product_id');
    if (!unsupportedDimensions.length) continue;

    errors.push(
      `recursive_dimension_breakdown node ${node.id} is incompatible with partial-day product analysis: product_id appears after ${unsupportedDimensions.join(', ')}. Put product_id first or keep max_depth below ${productIndex + 1}.`
    );
  }

  return errors;
}

function validateRunContextAgainstWorkflow(context, definition) {
  const errors = [];
  const window = context?.meta?.window;
  const baselineWindow = context?.meta?.baselineWindow;

  const usesPartialDayProductPath = (
    isPartialDayWindow(window?.start, window?.end)
    || isPartialDayWindow(baselineWindow?.start, baselineWindow?.end)
  );

  if (!usesPartialDayProductPath) {
    return { ok: true, errors };
  }

  const workflowErrors = getPartialDayProductCompatibilityErrors(definition);
  errors.push(...workflowErrors);

  const rootFilterDimensions = listHourlyProductUnsupportedFilters(context?.filters || []);
  if (rootFilterDimensions.length) {
    errors.push(
      `partial-day product analysis does not support filters on ${Array.from(new Set(rootFilterDimensions)).join(', ')}`
    );
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  getPartialDayProductCompatibilityErrors,
  validateRunContextAgainstWorkflow,
};
