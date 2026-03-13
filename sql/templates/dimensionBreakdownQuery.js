// sql/templates/dimensionBreakdownQuery.js

const {
  isFullDayAlignedWindow,
  listHourlyProductUnsupportedFilters,
  normalizeWindowForQuery
} = require('../../lib/timeWindowUtils');

const ALLOWED_DIMENSIONS = new Set([
  "product_id",
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'landing_page_path',
  'landing_page_type',
  'referrer_name'
]);

function assertSafeDimension(dimension) {
  if (!dimension || typeof dimension !== 'string') {
    throw new Error('dimensionBreakdownQuery: dimension is required');
  }
  if (!ALLOWED_DIMENSIONS.has(dimension)) {
    throw new Error(`dimensionBreakdownQuery: unsupported dimension "${dimension}"`);
  }
}

function buildFilterWhere(filters = []) {
  const clauses = [];
  const params = [];

  for (const f of filters) {
    if (!f?.dimension || f.value === undefined) continue;
    if (!ALLOWED_DIMENSIONS.has(f.dimension)) continue;
    if (Array.isArray(f.value)) {
      const values = Array.from(new Set(f.value.filter((value) => value !== undefined && value !== null && value !== '')));
      if (!values.length) continue;
      clauses.push(`${f.dimension} IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
      continue;
    }

    clauses.push(`${f.dimension} = ?`);
    params.push(f.value);
  }

  return {
    whereSql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
    params
  };
}

function buildNotNullFilter(dimension) {
  if (dimension === 'product_id') {
    return ' AND product_id IS NOT NULL';
  }
  return '';
}

function shouldUseHourlyProductRollup({ dimension, window, baselineWindow }) {
  if (dimension !== 'product_id') return false;
  const currentIsFullDay = isFullDayAlignedWindow(window?.start, window?.end);
  const baselineIsFullDay = isFullDayAlignedWindow(baselineWindow?.start, baselineWindow?.end);
  return !(currentIsFullDay && baselineIsFullDay);
}

function buildHourlyProductFilterWhere(filters = []) {
  const unsupportedDimensions = listHourlyProductUnsupportedFilters(filters);
  if (unsupportedDimensions.length) {
    throw new Error(
      `dimensionBreakdownQuery: hourly product analysis does not support filters on ${Array.from(new Set(unsupportedDimensions)).join(', ')}`
    );
  }

  const clauses = [];
  const params = [];

  for (const f of filters) {
    if (f?.dimension !== 'product_id' || f.value === undefined) continue;
    if (Array.isArray(f.value)) {
      const values = Array.from(new Set(f.value.filter((value) => value !== undefined && value !== null && value !== '')));
      if (!values.length) continue;
      clauses.push(`product_id IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
      continue;
    }

    clauses.push('product_id = ?');
    params.push(f.value);
  }

  return {
    whereSql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
    params
  };
}

module.exports = function dimensionBreakdownQuery({
  tenantId,
  dimension,
  window,
  baselineWindow,
  filters = [],
  includeOrders = true
}) {
  if (!tenantId) throw new Error('dimensionBreakdownQuery: tenantId is required (db selector)');
  if (!window?.start || !window?.end) throw new Error('dimensionBreakdownQuery: window.start/window.end required');
  if (!baselineWindow?.start || !baselineWindow?.end) throw new Error('dimensionBreakdownQuery: baselineWindow.start/window.end required');

  assertSafeDimension(dimension);

  const useHourlyProductRollup = shouldUseHourlyProductRollup({ dimension, window, baselineWindow });
  const { whereSql: filterSql, params: filterParams } = useHourlyProductRollup
    ? buildHourlyProductFilterWhere(filters)
    : buildFilterWhere(filters);
  const notNullSql = buildNotNullFilter(dimension);
  const normalizedWindow = normalizeWindowForQuery(window);
  const normalizedBaselineWindow = normalizeWindowForQuery(baselineWindow);
  const windowStart = normalizedWindow.start;
  const windowEnd = normalizedWindow.end;
  const baselineStart = normalizedBaselineWindow.start;
  const baselineEnd = normalizedBaselineWindow.end;
  const includeProductTitle = dimension === 'product_id';
  const titleStart = baselineStart;
  const titleEnd = windowEnd;

  const sql = useHourlyProductRollup ? `
WITH
current_sessions AS (
  SELECT
    product_id AS dimension_value,
    COALESCE(SUM(sessions), 0) AS sessions,
    COALESCE(SUM(sessions_with_cart_additions), 0) AS atc_sessions
  FROM hourly_product_performance_rollup
  WHERE CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') >= ?
    AND CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') <  ?
    ${filterSql}
    ${notNullSql}
  GROUP BY product_id
),
baseline_sessions AS (
  SELECT
    product_id AS dimension_value,
    COALESCE(SUM(sessions), 0) AS sessions,
    COALESCE(SUM(sessions_with_cart_additions), 0) AS atc_sessions
  FROM hourly_product_performance_rollup
  WHERE CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') >= ?
    AND CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') <  ?
    ${filterSql}
    ${notNullSql}
  GROUP BY product_id
),${includeOrders ? `
current_orders AS (
  SELECT
    product_id AS dimension_value,
    COALESCE(SUM(orders), 0) AS orders
  FROM hourly_product_performance_rollup
  WHERE CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') >= ?
    AND CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') <  ?
    ${filterSql}
    ${notNullSql}
  GROUP BY product_id
),
baseline_orders AS (
  SELECT
    product_id AS dimension_value,
    COALESCE(SUM(orders), 0) AS orders
  FROM hourly_product_performance_rollup
  WHERE CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') >= ?
    AND CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') <  ?
    ${filterSql}
    ${notNullSql}
  GROUP BY product_id
),` : ''}
product_titles AS (
  SELECT
    product_id AS dimension_value,
    MAX(product_title) AS product_title
  FROM hourly_product_performance_rollup
  WHERE CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') >= ?
    AND CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') <  ?
    ${filterSql}
    ${notNullSql}
  GROUP BY product_id
),
all_keys AS (
  SELECT dimension_value FROM current_sessions
  UNION
  SELECT dimension_value FROM baseline_sessions
  ${includeOrders ? `
  UNION
  SELECT dimension_value FROM current_orders
  UNION
  SELECT dimension_value FROM baseline_orders` : ''}
)
SELECT
  k.dimension_value,
  COALESCE(cs.sessions, 0) AS current_sessions,
  COALESCE(bs.sessions, 0) AS baseline_sessions,
  COALESCE(cs.atc_sessions, 0) AS current_atc_sessions,
  COALESCE(bs.atc_sessions, 0) AS baseline_atc_sessions,
  ${includeOrders ? 'COALESCE(co.orders, 0) AS current_orders,\n  COALESCE(bo.orders, 0) AS baseline_orders' : '0 AS current_orders,\n  0 AS baseline_orders'},
  pt.product_title
FROM all_keys k
LEFT JOIN current_sessions cs ON cs.dimension_value = k.dimension_value
LEFT JOIN baseline_sessions bs ON bs.dimension_value = k.dimension_value
${includeOrders ? 'LEFT JOIN current_orders co ON co.dimension_value = k.dimension_value\nLEFT JOIN baseline_orders bo ON bo.dimension_value = k.dimension_value' : ''}
LEFT JOIN product_titles pt ON pt.dimension_value = k.dimension_value
ORDER BY current_sessions DESC;
  ` : `
WITH
current_sessions AS (
  SELECT
    ${dimension} AS dimension_value,
    COALESCE(SUM(sessions), 0) AS sessions,
    COALESCE(SUM(sessions_with_cart_additions), 0) AS atc_sessions
  FROM product_sessions_snapshot
  WHERE date >= DATE(?)
    AND date <  DATE(?)
    ${filterSql}
    ${notNullSql}
  GROUP BY ${dimension}
),
baseline_sessions AS (
  SELECT
    ${dimension} AS dimension_value,
    COALESCE(SUM(sessions), 0) AS sessions,
    COALESCE(SUM(sessions_with_cart_additions), 0) AS atc_sessions
  FROM product_sessions_snapshot
  WHERE date >= DATE(?)
    AND date <  DATE(?)
    ${filterSql}
    ${notNullSql}
  GROUP BY ${dimension}
),${includeOrders ? `
current_orders AS (
  SELECT
    ${dimension} AS dimension_value,
    COALESCE(COUNT(DISTINCT order_name), 0) AS orders
  FROM shopify_orders
  WHERE created_at >= ?
    AND created_at <  ?
    ${filterSql}
  GROUP BY ${dimension}
),
baseline_orders AS (
  SELECT
    ${dimension} AS dimension_value,
    COALESCE(COUNT(DISTINCT order_name), 0) AS orders
  FROM shopify_orders
  WHERE created_at >= ?
    AND created_at <  ?
    ${filterSql}
  GROUP BY ${dimension}
),` : ''}
${includeProductTitle ? `product_titles AS (
  SELECT
    product_id AS dimension_value,
    MAX(product_title) AS product_title
  FROM product_sessions_snapshot
  WHERE date >= DATE(?)
    AND date <  DATE(?)
    ${filterSql}
    ${notNullSql}
  GROUP BY product_id
),` : ''}
all_keys AS (
  SELECT dimension_value FROM current_sessions
  UNION
  SELECT dimension_value FROM baseline_sessions
  ${includeOrders ? `
  UNION
  SELECT dimension_value FROM current_orders
  UNION
  SELECT dimension_value FROM baseline_orders` : ''}
)
SELECT
  k.dimension_value,

  COALESCE(cs.sessions, 0) AS current_sessions,
  COALESCE(bs.sessions, 0) AS baseline_sessions,

  COALESCE(cs.atc_sessions, 0) AS current_atc_sessions,
  COALESCE(bs.atc_sessions, 0) AS baseline_atc_sessions,

  ${includeOrders ? 'COALESCE(co.orders, 0) AS current_orders,\n  COALESCE(bo.orders, 0) AS baseline_orders' : '0 AS current_orders,\n  0 AS baseline_orders'}${includeProductTitle ? ',\n  pt.product_title' : ''}

FROM all_keys k
LEFT JOIN current_sessions cs ON cs.dimension_value = k.dimension_value
LEFT JOIN baseline_sessions bs ON bs.dimension_value = k.dimension_value
${includeOrders ? 'LEFT JOIN current_orders co ON co.dimension_value = k.dimension_value\nLEFT JOIN baseline_orders bo ON bo.dimension_value = k.dimension_value' : ''}
${includeProductTitle ? 'LEFT JOIN product_titles pt ON pt.dimension_value = k.dimension_value' : ''}
ORDER BY current_sessions DESC;
  `;

  const params = useHourlyProductRollup ? [
    windowStart, windowEnd,
    ...filterParams,

    baselineStart, baselineEnd,
    ...filterParams,

    ...(includeOrders ? [
      windowStart, windowEnd,
      ...filterParams,

      baselineStart, baselineEnd,
      ...filterParams
    ] : []),

    titleStart, titleEnd,
    ...filterParams
  ] : [
    windowStart, windowEnd,
    ...filterParams,

    baselineStart, baselineEnd,
    ...filterParams,

    ...(includeOrders ? [
      windowStart, windowEnd,
      ...filterParams,
      baselineStart, baselineEnd,
      ...filterParams
    ] : []),
    ...(includeProductTitle ? [titleStart, titleEnd, ...filterParams] : [])
  ];

  return {
    sql,
    params,
    meta: {
      tenantId, // db selector
      type: 'dimension_breakdown',
      dimension
    }
  };
};
