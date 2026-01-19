// sql/templates/dimensionBreakdownQuery.js

const ALLOWED_DIMENSIONS = new Set([
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

function normalizeDateTime(value) {
  if (!value || typeof value !== 'string') return value;
  return value.replace('T', ' ').replace('Z', '');
}

function buildFilterWhere(filters = []) {
  const clauses = [];
  const params = [];

  for (const f of filters) {
    if (!f?.dimension || f.value === undefined) continue;
    if (!ALLOWED_DIMENSIONS.has(f.dimension)) continue;

    clauses.push(`${f.dimension} = ?`);
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
  filters = []
}) {
  if (!tenantId) throw new Error('dimensionBreakdownQuery: tenantId is required (db selector)');
  if (!window?.start || !window?.end) throw new Error('dimensionBreakdownQuery: window.start/window.end required');
  if (!baselineWindow?.start || !baselineWindow?.end) throw new Error('dimensionBreakdownQuery: baselineWindow.start/window.end required');

  assertSafeDimension(dimension);

  const { whereSql: filterSql, params: filterParams } = buildFilterWhere(filters);
  const windowStart = normalizeDateTime(window.start);
  const windowEnd = normalizeDateTime(window.end);
  const baselineStart = normalizeDateTime(baselineWindow.start);
  const baselineEnd = normalizeDateTime(baselineWindow.end);

  const sql = `
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
  GROUP BY ${dimension}
),
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
),
all_keys AS (
  SELECT dimension_value FROM current_sessions
  UNION
  SELECT dimension_value FROM baseline_sessions
  UNION
  SELECT dimension_value FROM current_orders
  UNION
  SELECT dimension_value FROM baseline_orders
)
SELECT
  k.dimension_value,

  COALESCE(cs.sessions, 0) AS current_sessions,
  COALESCE(bs.sessions, 0) AS baseline_sessions,

  COALESCE(cs.atc_sessions, 0) AS current_atc_sessions,
  COALESCE(bs.atc_sessions, 0) AS baseline_atc_sessions,

  COALESCE(co.orders, 0) AS current_orders,
  COALESCE(bo.orders, 0) AS baseline_orders

FROM all_keys k
LEFT JOIN current_sessions cs ON cs.dimension_value = k.dimension_value
LEFT JOIN baseline_sessions bs ON bs.dimension_value = k.dimension_value
LEFT JOIN current_orders co ON co.dimension_value = k.dimension_value
LEFT JOIN baseline_orders bo ON bo.dimension_value = k.dimension_value
ORDER BY current_sessions DESC;
  `;

  const params = [
    windowStart, windowEnd,
    ...filterParams,

    baselineStart, baselineEnd,
    ...filterParams,

    windowStart, windowEnd,
    ...filterParams,

    baselineStart, baselineEnd,
    ...filterParams
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
