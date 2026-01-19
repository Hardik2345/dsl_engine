// sql/templates/metricQuery.js

function normalizeDateTime(value) {
  if (!value || typeof value !== 'string') return value;
  return value.replace('T', ' ').replace('Z', '');
}

module.exports = function metricQuery({ tenantId, metrics = [], window, baselineWindow }) {
  if (!tenantId) throw new Error('metricQuery: tenantId is required (db selector)');
  if (!window?.start || !window?.end) throw new Error('metricQuery: window.start/window.end required');
  if (!baselineWindow?.start || !baselineWindow?.end) throw new Error('metricQuery: baselineWindow.start/window.end required');

  const windowStart = normalizeDateTime(window.start);
  const windowEnd = normalizeDateTime(window.end);
  const baselineStart = normalizeDateTime(baselineWindow.start);
  const baselineEnd = normalizeDateTime(baselineWindow.end);

  const sql = `
WITH
current_sessions AS (
  SELECT
    COALESCE(SUM(number_of_sessions), 0) AS sessions,
    COALESCE(SUM(number_of_atc_sessions), 0) AS atc_sessions,
    COALESCE(SUM(adjusted_number_of_sessions), 0) AS adjusted_sessions
  FROM hourly_sessions_summary_shopify
  WHERE CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') >= ?
    AND CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') <  ?
),
baseline_sessions AS (
  SELECT
    COALESCE(SUM(number_of_sessions), 0) AS sessions,
    COALESCE(SUM(number_of_atc_sessions), 0) AS atc_sessions,
    COALESCE(SUM(adjusted_number_of_sessions), 0) AS adjusted_sessions
  FROM hourly_sessions_summary_shopify
  WHERE CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') >= ?
    AND CONCAT(date, ' ', LPAD(hour, 2, '0'), ':00:00') <  ?
),
current_orders AS (
  SELECT
    COALESCE(COUNT(DISTINCT order_name), 0) AS orders
  FROM shopify_orders
  WHERE created_at >= ?
    AND created_at <  ?
),
baseline_orders AS (
  SELECT
    COALESCE(COUNT(DISTINCT order_name), 0) AS orders
  FROM shopify_orders
  WHERE created_at >= ?
    AND created_at <  ?
)
SELECT
  cs.sessions AS current_sessions,
  bs.sessions AS baseline_sessions,

  cs.atc_sessions AS current_atc_sessions,
  bs.atc_sessions AS baseline_atc_sessions,

  cs.adjusted_sessions AS current_adjusted_sessions,
  bs.adjusted_sessions AS baseline_adjusted_sessions,

  co.orders AS current_orders,
  bo.orders AS baseline_orders
FROM current_sessions cs
CROSS JOIN baseline_sessions bs
CROSS JOIN current_orders co
CROSS JOIN baseline_orders bo;
  `;

  const params = [
    windowStart, windowEnd,
    baselineStart, baselineEnd,
    windowStart, windowEnd,
    baselineStart, baselineEnd
  ];

  return {
    sql,
    params,
    meta: {
      tenantId, // db name selector
      type: 'metric',
      metricsRequested: metrics
    }
  };
};
