const queryBuilder = require('../sql/QueryBuilder');
const queryExecutor = require('../sql/QueryExecutor');

async function RecursiveDimensionBreakdownNode(def, context) {
  const {
    dimension,
    dimensions = [],
    base_metric = 'cvr',
    stop_conditions = {},
    next
  } = def;

  const {
    max_depth = 1,
    min_sessions = 0,
    min_current_sessions = min_sessions,
    min_baseline_sessions = min_sessions,
    min_impact_pct = 0,
    top_k = 1          // <--- ranking control (default MVP = 1)
  } = stop_conditions;

  const {
    meta,
    metrics,
    filters = []
  } = context;

  const dimensionList = Array.isArray(dimensions) && dimensions.length
    ? dimensions
    : [dimension];

  if (!dimensionList[0] || typeof dimensionList[0] !== 'string') {
    return {
      status: 'fail',
      reason: 'RecursiveDimensionBreakdownNode: dimension is missing or invalid'
    };
  }

  if (!metrics || metrics.cvr_delta_pct == null) {
    return {
      status: 'fail',
      reason: 'RecursiveDimensionBreakdownNode: global metrics missing'
    };
  }

  const evidence = [];

  /**
   * Internal recursive function
   * Recursion axis: filters + depth
   */
  async function recurse(activeFilters, depth) {
    if (depth >= max_depth) return;
    if (depth >= dimensionList.length) return;

    const activeDimension = dimensionList[depth];

    const querySpec = queryBuilder.buildDimensionBreakdownQuery({
      tenantId: meta.tenantId,
      dimension: activeDimension,
      window: meta.window,
      baselineWindow: meta.baselineWindow,
      filters: activeFilters
    });

    const result = await queryExecutor.execute(querySpec);
    if (!result?.rows?.length) return;

    const candidates = [];
    let totalBaselineSessions = 0;
    let totalCurrentSessions = 0;
    let totalBaselineOrders = 0;
    let totalCurrentOrders = 0;

    for (const row of result.rows) {
      const { baseline_sessions, current_sessions } = row;
      if (baseline_sessions > 0) {
        totalBaselineSessions += baseline_sessions;
      }
      if (current_sessions > 0) {
        totalCurrentSessions += current_sessions;
      }

      const { baseline_orders, current_orders } = row;
      if (baseline_orders > 0) {
        totalBaselineOrders += baseline_orders;
      }
      if (current_orders > 0) {
        totalCurrentOrders += current_orders;
      }
    }

    if (totalBaselineSessions === 0 && totalCurrentSessions === 0) return;

    // ---------- Phase 1: collect candidates ----------
    for (const row of result.rows) {
      const {
        dimension_value,
        product_title,
        current_orders,
        baseline_orders,
        current_sessions,
        baseline_sessions
      } = row;

      if (
        current_sessions < min_current_sessions &&
        baseline_sessions < min_baseline_sessions
      ) continue;

      const current_cvr =
        current_sessions === 0 ? null : current_orders / current_sessions;

      const baseline_cvr =
        baseline_sessions === 0
          ? metrics.baseline_cvr
          : baseline_orders / baseline_sessions;

      if (current_cvr == null || baseline_cvr == null) continue;
      if (baseline_cvr === 0) continue;

      const cvr_delta_pct =
        ((current_cvr - baseline_cvr) / baseline_cvr) * 100;

      if (cvr_delta_pct >= 0) continue;

      const orders_delta_pct =
        baseline_orders === 0
          ? null
          : ((current_orders - baseline_orders) / baseline_orders) * 100;

      const sessions_delta_pct =
        baseline_sessions === 0
          ? null
          : ((current_sessions - baseline_sessions) / baseline_sessions) * 100;

      const baselineShare =
        totalBaselineSessions === 0 ? 0 : baseline_sessions / totalBaselineSessions;
      const currentShare =
        totalCurrentSessions === 0 ? 0 : current_sessions / totalCurrentSessions;
      const sessionShare = Math.max(baselineShare, currentShare);

      const baselineOrderShare =
        totalBaselineOrders === 0 ? 0 : baseline_orders / totalBaselineOrders;
      const currentOrderShare =
        totalCurrentOrders === 0 ? 0 : current_orders / totalCurrentOrders;
      const orderShare = Math.max(baselineOrderShare, currentOrderShare);

      const displayValue =
        activeDimension === 'product_id' && product_title
          ? product_title
          : dimension_value;

      candidates.push({
        dimension: activeDimension,
        value: dimension_value,
        display_value: displayValue,
        depth,
        current: {
          orders: current_orders,
          sessions: current_sessions,
          cvr: current_cvr
        },
        baseline: {
          orders: baseline_orders,
          sessions: baseline_sessions,
          cvr: baseline_cvr
        },
        deltas: {
          cvr_delta_pct,
          orders_delta_pct,
          sessions_delta_pct
        },
        sessionShare,
        orderShare,
        base_metric
      });
    }

    if (!candidates.length) return;

    const filteredCandidates = candidates;

    // ---------- Phase 2: rank ----------
    const scoreFor = (entry) => {
      const metric = entry.base_metric || base_metric || 'cvr';
      if (metric === 'orders') {
        const pct = entry.deltas.orders_delta_pct;
        const share = entry.orderShare ?? entry.sessionShare ?? 0;
        return pct == null ? -Infinity : Math.abs(pct) * share;
      }
      if (metric === 'sessions') {
        const pct = entry.deltas.sessions_delta_pct;
        return pct == null ? -Infinity : Math.abs(pct);
      }
      // default cvr
      const pct = entry.deltas.cvr_delta_pct;
      return pct == null ? -Infinity : Math.abs(pct) * entry.sessionShare;
    };

    filteredCandidates.sort((a, b) => {
      const aScore = scoreFor(a);
      const bScore = scoreFor(b);
      return bScore - aScore;
    });

    const topCandidates = filteredCandidates.slice(0, top_k);

    // ---------- Phase 3: store evidence + recurse ----------
    for (const entry of topCandidates) {
      evidence.push(entry);

      await recurse(
        [...activeFilters, { dimension: activeDimension, value: entry.value }],
        depth + 1
      );
    }
  }

  // Kick off recursion
  await recurse(filters, 0);

  const mergedEvidenceMap = new Map();
  for (const entry of evidence) {
    const key = `${entry.dimension}::${entry.value}::${entry.depth}`;
    const existing = mergedEvidenceMap.get(key);
    if (!existing || entry.sessionShare > existing.sessionShare) {
      mergedEvidenceMap.set(key, entry);
    }
  }

  const mergedEvidence = Array.from(mergedEvidenceMap.values());

  return {
    status: 'pass',
    delta: {
      breakdowns: {
        [dimensionList[0]]: mergedEvidence
      }
    },
    next
  };
}

module.exports = RecursiveDimensionBreakdownNode;
