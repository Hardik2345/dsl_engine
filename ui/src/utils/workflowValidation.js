const SQL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

function parseSqlDateTime(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace('T', ' ').replace('Z', '');
  const match = normalized.match(SQL_DATETIME_RE);
  if (!match) return null;

  const [, year, month, day, hour, minute, second = '00'] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
}

function toUtcMs(parts) {
  if (!parts) return NaN;
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

function isHourAligned(value) {
  const parts = typeof value === 'string' ? parseSqlDateTime(value) : value;
  return Boolean(parts) && parts.minute === 0 && parts.second === 0;
}

export function isFullDayAlignedWindow(start, end) {
  const startParts = typeof start === 'string' ? parseSqlDateTime(start) : start;
  const endParts = typeof end === 'string' ? parseSqlDateTime(end) : end;
  if (!startParts || !endParts) return false;
  if (!isHourAligned(startParts) || !isHourAligned(endParts)) return false;
  if (startParts.hour !== 0 || endParts.hour !== 0) return false;

  const durationMs = toUtcMs(endParts) - toUtcMs(startParts);
  if (durationMs <= 0) return false;

  const durationHours = durationMs / (60 * 60 * 1000);
  return Number.isInteger(durationHours) && durationHours % 24 === 0;
}

export function isPartialDayWindow(start, end) {
  const startParts = typeof start === 'string' ? parseSqlDateTime(start) : start;
  const endParts = typeof end === 'string' ? parseSqlDateTime(end) : end;
  if (!startParts || !endParts) return false;
  if (!isHourAligned(startParts) || !isHourAligned(endParts)) return false;
  return !isFullDayAlignedWindow(startParts, endParts);
}

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

export function getPartialDayProductCompatibilityErrors(workflowJson) {
  if (!workflowJson || !Array.isArray(workflowJson.nodes)) return [];

  const errors = [];

  workflowJson.nodes.forEach((node) => {
    if (node?.type !== 'recursive_dimension_breakdown') return;

    const dimensions = getRecursiveDimensions(node);
    if (!dimensions.length) return;

    const reachableDepthCount = getReachableDepthCount(node, dimensions.length);
    const productIndex = dimensions.indexOf('product_id');
    if (productIndex === -1 || productIndex >= reachableDepthCount || productIndex === 0) {
      return;
    }

    const precedingDimensions = dimensions.slice(0, productIndex).filter((dimension) => dimension !== 'product_id');
    if (!precedingDimensions.length) return;

    errors.push(
      `Node "${node.id}" cannot support partial-day product analysis because product_id appears after ${precedingDimensions.join(', ')}. Put product_id first or reduce max depth below ${productIndex + 1}.`
    );
  });

  return errors;
}

export function getNodePartialDayProductWarnings(nodeData) {
  if (!nodeData || nodeData.type !== 'recursive_dimension_breakdown') return [];
  return getPartialDayProductCompatibilityErrors({ nodes: [nodeData] });
}

export function validateRunDateRanges({ windowStart, windowEnd, baselineStart, baselineEnd }) {
  const errors = [];
  const ranges = [
    { label: 'Analysis window', start: windowStart, end: windowEnd },
    { label: 'Baseline window', start: baselineStart, end: baselineEnd },
  ];

  for (const range of ranges) {
    if (!range.start || !range.end) {
      errors.push(`${range.label} start and end are required.`);
      continue;
    }

    const startParts = parseSqlDateTime(range.start);
    const endParts = parseSqlDateTime(range.end);
    if (!startParts || !endParts) {
      errors.push(`${range.label} must use a valid date and hour.`);
      continue;
    }

    if (!isHourAligned(startParts) || !isHourAligned(endParts)) {
      errors.push(`${range.label} must be aligned to the hour. Minutes and seconds must be 00.`);
    }

    if (toUtcMs(endParts) <= toUtcMs(startParts)) {
      errors.push(`${range.label} end must be after start.`);
    }
  }

  return errors;
}
