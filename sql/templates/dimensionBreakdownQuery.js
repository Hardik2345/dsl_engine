// sql/templates/dimensionBreakdownQuery.js

const {
  isFullDayAlignedWindow,
  listHourlyProductUnsupportedFilters,
  listHourlyLandingPagePathUnsupportedFilters,
  normalizeWindowForQuery
} = require('../../lib/timeWindowUtils');

const ALLOWED_DIMENSIONS = new Set([
  'product_id',
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

function shouldUseHourlyLandingPagePathAttribution({ dimension, window, baselineWindow }) {
  if (dimension !== 'landing_page_path') return false;
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

  return buildHourlyProductIdOnlyFilterWhere(filters);
}

function buildHourlyLandingPagePathFilterWhere(filters = []) {
  const unsupportedDimensions = listHourlyLandingPagePathUnsupportedFilters(filters);
  if (unsupportedDimensions.length) {
    throw new Error(
      `dimensionBreakdownQuery: hourly landing_page_path analysis does not support filters on ${Array.from(new Set(unsupportedDimensions)).join(', ')}`
    );
  }

  return buildHourlyProductIdOnlyFilterWhere(filters);
}

function buildHourlyProductIdOnlyFilterWhere(filters = []) {
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

function buildHourlyProductRollupSql({ filterSql, notNullSql, includeOrders }) {
  return `
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
  `;
}

function buildHourlyLandingPagePathSql({ filterSql, includeOrders }) {
  return `
WITH
current_path_product_sessions AS (
  SELECT
    landing_page_path AS dimension_value,
    product_id,
    COALESCE(SUM(sessions), 0) AS sessions,
    COALESCE(SUM(sessions_with_cart_additions), 0) AS atc_sessions
  FROM hourly_product_sessions
  WHERE CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') >= ?
    AND CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') <  ?
    ${filterSql}
    AND product_id IS NOT NULL
  GROUP BY landing_page_path, product_id
),
baseline_path_product_sessions AS (
  SELECT
    landing_page_path AS dimension_value,
    product_id,
    COALESCE(SUM(sessions), 0) AS sessions,
    COALESCE(SUM(sessions_with_cart_additions), 0) AS atc_sessions
  FROM hourly_product_sessions
  WHERE CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') >= ?
    AND CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') <  ?
    ${filterSql}
    AND product_id IS NOT NULL
  GROUP BY landing_page_path, product_id
),
current_product_session_totals AS (
  SELECT product_id, SUM(sessions) AS total_sessions
  FROM current_path_product_sessions
  GROUP BY product_id
),
baseline_product_session_totals AS (
  SELECT product_id, SUM(sessions) AS total_sessions
  FROM baseline_path_product_sessions
  GROUP BY product_id
),${includeOrders ? `
current_product_orders AS (
  SELECT
    product_id,
    COALESCE(COUNT(DISTINCT order_name), 0) AS orders
  FROM shopify_orders
  WHERE created_date >= DATE(?)
    AND created_date <= DATE(?)
    AND COALESCE(
      created_at,
      STR_TO_DATE(CONCAT(created_date, ' ', created_time), '%Y-%m-%d %H:%i:%s')
    ) >= ?
    AND COALESCE(
      created_at,
      STR_TO_DATE(CONCAT(created_date, ' ', created_time), '%Y-%m-%d %H:%i:%s')
    ) <  ?
    ${filterSql}
    AND product_id IS NOT NULL
  GROUP BY product_id
),
baseline_product_orders AS (
  SELECT
    product_id,
    COALESCE(COUNT(DISTINCT order_name), 0) AS orders
  FROM shopify_orders
  WHERE created_date >= DATE(?)
    AND created_date <= DATE(?)
    AND COALESCE(
      created_at,
      STR_TO_DATE(CONCAT(created_date, ' ', created_time), '%Y-%m-%d %H:%i:%s')
    ) >= ?
    AND COALESCE(
      created_at,
      STR_TO_DATE(CONCAT(created_date, ' ', created_time), '%Y-%m-%d %H:%i:%s')
    ) <  ?
    ${filterSql}
    AND product_id IS NOT NULL
  GROUP BY product_id
),
current_allocated_orders AS (
  SELECT
    cps.dimension_value,
    SUM(
      CASE
        WHEN cst.total_sessions > 0
          THEN COALESCE(cpo.orders, 0) * (cps.sessions / cst.total_sessions)
        ELSE 0
      END
    ) AS orders
  FROM current_path_product_sessions cps
  LEFT JOIN current_product_session_totals cst ON cst.product_id = cps.product_id
  LEFT JOIN current_product_orders cpo ON cpo.product_id = cps.product_id
  GROUP BY cps.dimension_value
),
baseline_allocated_orders AS (
  SELECT
    bps.dimension_value,
    SUM(
      CASE
        WHEN bst.total_sessions > 0
          THEN COALESCE(bpo.orders, 0) * (bps.sessions / bst.total_sessions)
        ELSE 0
      END
    ) AS orders
  FROM baseline_path_product_sessions bps
  LEFT JOIN baseline_product_session_totals bst ON bst.product_id = bps.product_id
  LEFT JOIN baseline_product_orders bpo ON bpo.product_id = bps.product_id
  GROUP BY bps.dimension_value
),` : ''}
current_path_metrics AS (
  SELECT
    dimension_value,
    COALESCE(SUM(sessions), 0) AS sessions,
    COALESCE(SUM(atc_sessions), 0) AS atc_sessions
  FROM current_path_product_sessions
  GROUP BY dimension_value
),
baseline_path_metrics AS (
  SELECT
    dimension_value,
    COALESCE(SUM(sessions), 0) AS sessions,
    COALESCE(SUM(atc_sessions), 0) AS atc_sessions
  FROM baseline_path_product_sessions
  GROUP BY dimension_value
),
all_keys AS (
  SELECT dimension_value FROM current_path_metrics
  UNION
  SELECT dimension_value FROM baseline_path_metrics
  ${includeOrders ? `
  UNION
  SELECT dimension_value FROM current_allocated_orders
  UNION
  SELECT dimension_value FROM baseline_allocated_orders` : ''}
)
SELECT
  k.dimension_value,
  COALESCE(cm.sessions, 0) AS current_sessions,
  COALESCE(bm.sessions, 0) AS baseline_sessions,
  COALESCE(cm.atc_sessions, 0) AS current_atc_sessions,
  COALESCE(bm.atc_sessions, 0) AS baseline_atc_sessions,
  ${includeOrders ? 'COALESCE(cao.orders, 0) AS current_orders,\n  COALESCE(bao.orders, 0) AS baseline_orders' : '0 AS current_orders,\n  0 AS baseline_orders'}
FROM all_keys k
LEFT JOIN current_path_metrics cm ON cm.dimension_value = k.dimension_value
LEFT JOIN baseline_path_metrics bm ON bm.dimension_value = k.dimension_value
${includeOrders ? 'LEFT JOIN current_allocated_orders cao ON cao.dimension_value = k.dimension_value\nLEFT JOIN baseline_allocated_orders bao ON bao.dimension_value = k.dimension_value' : ''}
ORDER BY current_sessions DESC;
  `;
}

function buildDefaultDimensionSql({ dimension, filterSql, notNullSql, includeOrders, includeProductTitle }) {
  return `
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
  WHERE created_date >= DATE(?)
    AND created_date <  DATE(?)
    ${filterSql}
  GROUP BY ${dimension}
),
baseline_orders AS (
  SELECT
    ${dimension} AS dimension_value,
    COALESCE(COUNT(DISTINCT order_name), 0) AS orders
  FROM shopify_orders
  WHERE created_date >= DATE(?)
    AND created_date <  DATE(?)
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
}

module.exports = function dimensionBreakdownQuery({
  tenantId,
  dimension,
  window,
  baselineWindow,
  timezone,
  filters = [],
  includeOrders = true
}) {
  if (!tenantId) throw new Error('dimensionBreakdownQuery: tenantId is required (db selector)');
  if (!window?.start || !window?.end) throw new Error('dimensionBreakdownQuery: window.start/window.end required');
  if (!baselineWindow?.start || !baselineWindow?.end) throw new Error('dimensionBreakdownQuery: baselineWindow.start/window.end required');

  assertSafeDimension(dimension);

  const normalizedWindow = normalizeWindowForQuery(window, timezone);
  const normalizedBaselineWindow = normalizeWindowForQuery(baselineWindow, timezone);
  const useHourlyProductRollup = shouldUseHourlyProductRollup({
    dimension,
    window: normalizedWindow,
    baselineWindow: normalizedBaselineWindow
  });
  const useHourlyLandingPagePathAttribution = shouldUseHourlyLandingPagePathAttribution({
    dimension,
    window: normalizedWindow,
    baselineWindow: normalizedBaselineWindow
  });
  const { whereSql: filterSql, params: filterParams } = useHourlyProductRollup
    ? buildHourlyProductFilterWhere(filters)
    : useHourlyLandingPagePathAttribution
      ? buildHourlyLandingPagePathFilterWhere(filters)
      : buildFilterWhere(filters);

  const notNullSql = buildNotNullFilter(dimension);
  const windowStart = normalizedWindow.start;
  const windowEnd = normalizedWindow.end;
  const baselineStart = normalizedBaselineWindow.start;
  const baselineEnd = normalizedBaselineWindow.end;
  const includeProductTitle = dimension === 'product_id';
  const titleStart = baselineStart;
  const titleEnd = windowEnd;

  const sql = useHourlyProductRollup
    ? buildHourlyProductRollupSql({ filterSql, notNullSql, includeOrders })
    : useHourlyLandingPagePathAttribution
      ? buildHourlyLandingPagePathSql({ filterSql, includeOrders })
      : buildDefaultDimensionSql({ dimension, filterSql, notNullSql, includeOrders, includeProductTitle });

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
  ] : useHourlyLandingPagePathAttribution ? [
    windowStart, windowEnd,
    ...filterParams,

    baselineStart, baselineEnd,
    ...filterParams,

    ...(includeOrders ? [
      windowStart, windowEnd,
      windowStart, windowEnd,
      ...filterParams,

      baselineStart, baselineEnd,
      baselineStart, baselineEnd,
      ...filterParams
    ] : [])
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
      tenantId,
      type: 'dimension_breakdown',
      dimension
    }
  };
};
