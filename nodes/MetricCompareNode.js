const queryBuilder = require('../sql/QueryBuilder');
const queryExecutor = require('../sql/QueryExecutor');

async function MetricCompareNode(def, context) {
  const { window, baselineWindow, tenantId } = context.meta || {};

  // --- 1. Build query specs (intent only) ---
  const querySpec = queryBuilder.buildMetricQuery({
    tenantId,
    metrics: def.metrics,
    window,
    baselineWindow
  });

  // --- 2. Execute queries (execution only) ---
  const result = await queryExecutor.execute(querySpec);

  // --- 3. Validate results (fail loudly, never guess) ---
  if (
    !result?.rows?.length
  ) {
    return {
      status: 'fail',
      reason: 'MetricCompareNode: Missing current or baseline data'
    };
  }

  const row = result.rows[0];

  const {
    current_orders,
    baseline_orders,
    current_sessions,
    baseline_sessions
  } = row;

  const currentOrdersNum = Number(current_orders);
  const baselineOrdersNum = Number(baseline_orders);
  const currentSessionsNum = Number(current_sessions);
  const baselineSessionsNum = Number(baseline_sessions);

  if (
    baselineSessionsNum === 0 ||
    currentSessionsNum === 0
  ) {
    return {
      status: 'fail',
      reason: 'MetricCompareNode: Sessions count is zero, cannot compute CVR'
    };
  }

  // --- 4. Derive metrics (pure math, deterministic) ---
  const current_cvr = currentOrdersNum / currentSessionsNum;
  const baseline_cvr = baselineOrdersNum / baselineSessionsNum;

  const orders_delta_pct =
    baselineOrdersNum === 0
      ? null
      : ((currentOrdersNum - baselineOrdersNum) / baselineOrdersNum) * 100;

  const sessions_delta_pct =
    baselineSessionsNum === 0
      ? null
      : ((currentSessionsNum - baselineSessionsNum) / baselineSessionsNum) * 100;

  const cvr_delta_pct =
    baseline_cvr === 0
      ? null
      : ((current_cvr - baseline_cvr) / baseline_cvr) * 100;

  // --- 5. Return full ground truth (single return, complete facts) ---
  return {
    status: 'pass',
    delta: {
      metrics: {
        // raw aggregates
        current_orders: currentOrdersNum,
        baseline_orders: baselineOrdersNum,
        current_sessions: currentSessionsNum,
        baseline_sessions: baselineSessionsNum,

        // derived
        current_cvr,
        baseline_cvr,

        // deltas
        orders_delta_pct,
        sessions_delta_pct,
        cvr_delta_pct
      }
    },
    next: def.next
  };
}

module.exports = MetricCompareNode;
