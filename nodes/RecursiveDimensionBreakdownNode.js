const queryBuilder = require('../sql/QueryBuilder');
const queryExecutor = require('../sql/QueryExecutor');

async function RecursiveDimensionBreakdownNode(def, context) {
  const {
    dimension,
    dimensions = [],
    base_metric = 'cvr',
    include_orders,
    stop_conditions = {},
    rank_by = 'delta',
    rank_order = 'desc',
    filter_mode = 'drop',
    min_sessions_mode = 'both_low',
    output_key,
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

    const needsOrders = base_metric === 'orders' || base_metric === 'cvr';
    const includeOrders = include_orders ?? needsOrders;

    const querySpec = queryBuilder.buildDimensionBreakdownQuery({
      tenantId: meta.tenantId,
      dimension: activeDimension,
      window: meta.window,
      baselineWindow: meta.baselineWindow,
      filters: activeFilters,
      includeOrders
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
        baseline_sessions,
        current_atc_sessions,
        baseline_atc_sessions
      } = row;

      const currentLow = current_sessions < min_current_sessions;
      const baselineLow = baseline_sessions < min_baseline_sessions;
      if (min_sessions_mode === 'baseline_only') {
        if (baselineLow) continue;
      } else if (min_sessions_mode === 'either_low') {
        if (currentLow || baselineLow) continue;
      } else {
        if (currentLow && baselineLow) continue;
      }

      const current_cvr =
        current_sessions === 0 ? null : current_orders / current_sessions;

      const baseline_cvr_calc =
        baseline_sessions === 0
          ? null
          : baseline_orders / baseline_sessions;

      const baseline_cvr =
        baseline_sessions === 0
          ? metrics.baseline_cvr
          : baseline_orders / baseline_sessions;

      const current_atc_rate =
        current_sessions === 0 ? null : current_atc_sessions / current_sessions;

      const baseline_atc_rate =
        baseline_sessions === 0
          ? (metrics.baseline_atc_rate || null)
          : baseline_atc_sessions / baseline_sessions;

      // For atc_rate base_metric, allow null CVR but require valid atc_rate
      const isAtcMetric = (base_metric === 'atc_rate');
      if (!isAtcMetric && (current_cvr == null || baseline_cvr == null)) continue;
      if (!isAtcMetric && baseline_cvr === 0) continue;
      if (isAtcMetric && (current_atc_rate == null || baseline_atc_rate == null)) continue;
      if (isAtcMetric && baseline_atc_rate === 0) continue;

      const cvr_delta_pct =
        (baseline_cvr == null || baseline_cvr === 0)
          ? null
          : ((current_cvr - baseline_cvr) / baseline_cvr) * 100;

      const atc_rate_delta_pct =
        (baseline_atc_rate == null || baseline_atc_rate === 0)
          ? null
          : ((current_atc_rate - baseline_atc_rate) / baseline_atc_rate) * 100;

      const atc_sessions_delta_pct =
        baseline_atc_sessions === 0
          ? null
          : ((current_atc_sessions - baseline_atc_sessions) / baseline_atc_sessions) * 100;

      if (filter_mode === 'drop') {
        if (isAtcMetric && (atc_rate_delta_pct == null || atc_rate_delta_pct >= 0)) continue;
        if (!isAtcMetric && (cvr_delta_pct == null || cvr_delta_pct >= 0)) continue;
      }

      if (filter_mode === 'increase') {
        if (isAtcMetric && (atc_rate_delta_pct == null || atc_rate_delta_pct <= 0)) continue;
        if (!isAtcMetric && (cvr_delta_pct == null || cvr_delta_pct <= 0)) continue;
      }

      if (rank_by === 'baseline_cvr' && baseline_cvr_calc == null) continue;

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
          atc_sessions: current_atc_sessions,
          cvr: current_cvr,
          atc_rate: current_atc_rate
        },
        baseline: {
          orders: baseline_orders,
          sessions: baseline_sessions,
          atc_sessions: baseline_atc_sessions,
          cvr: baseline_cvr_calc ?? baseline_cvr,
          atc_rate: baseline_atc_rate
        },
        deltas: {
          cvr_delta_pct,
          atc_rate_delta_pct,
          atc_sessions_delta_pct,
          orders_delta_pct,
          sessions_delta_pct
        },
        sessionShare,
        orderShare,
        baselineSessionShare: baselineShare,
        baselineOrderShare,
        base_metric
      });
    }

    if (!candidates.length) return;

    const filteredCandidates = candidates;

    // ---------- Phase 2: rank ----------
    const scoreFor = (entry) => {
      const baselineSessionShare = entry.baselineSessionShare ?? 0;
      const baselineOrderShare = entry.baselineOrderShare ?? 0;

      if (rank_by === 'baseline_cvr') {
        const pct = entry.baseline?.cvr;
        return pct == null ? -Infinity : Math.abs(pct) * baselineSessionShare;
      }
      if (rank_by === 'baseline_sessions') {
        return baselineSessionShare || 0;
      }
      if (rank_by === 'baseline_orders') {
        return baselineOrderShare || 0;
      }

      const metric = entry.base_metric || base_metric || 'cvr';
      if (metric === 'orders') {
        const pct = entry.deltas.orders_delta_pct;
        return pct == null ? -Infinity : Math.abs(pct) * baselineOrderShare;
      }
      if (metric === 'sessions') {
        const pct = entry.deltas.sessions_delta_pct;
        return pct == null ? -Infinity : Math.abs(pct) * baselineSessionShare;
      }
      if (metric === 'atc_rate') {
        const pct = entry.deltas.atc_rate_delta_pct;
        return pct == null ? -Infinity : Math.abs(pct) * baselineSessionShare;
      }
      // default cvr
      const pct = entry.deltas.cvr_delta_pct;
      return pct == null ? -Infinity : Math.abs(pct) * baselineSessionShare;
    };

    filteredCandidates.sort((a, b) => {
      const aScore = scoreFor(a);
      const bScore = scoreFor(b);
      return rank_order === 'asc' ? aScore - bScore : bScore - aScore;
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

  const scoreForEntry = (entry) => {
    const baselineSessionShare = entry.baselineSessionShare ?? 0;
    const baselineOrderShare = entry.baselineOrderShare ?? 0;

    if (rank_by === 'baseline_cvr') {
      const pct = entry.baseline?.cvr;
      return pct == null ? -Infinity : Math.abs(pct) * baselineSessionShare;
    }
    if (rank_by === 'baseline_sessions') {
      return baselineSessionShare || 0;
    }
    if (rank_by === 'baseline_orders') {
      return baselineOrderShare || 0;
    }

    const metric = entry.base_metric || base_metric || 'cvr';
    if (metric === 'orders') {
      const pct = entry.deltas?.orders_delta_pct;
      return pct == null ? -Infinity : Math.abs(pct) * baselineOrderShare;
    }
    if (metric === 'sessions') {
      const pct = entry.deltas?.sessions_delta_pct;
      return pct == null ? -Infinity : Math.abs(pct) * baselineSessionShare;
    }
    if (metric === 'atc_rate') {
      const pct = entry.deltas?.atc_rate_delta_pct;
      return pct == null ? -Infinity : Math.abs(pct) * baselineSessionShare;
    }
    const pct = entry.deltas?.cvr_delta_pct;
    return pct == null ? -Infinity : Math.abs(pct) * baselineSessionShare;
  };

  const rankedEvidence = [...mergedEvidence].sort((a, b) => {
    const aScore = scoreForEntry(a);
    const bScore = scoreForEntry(b);
    return rank_order === 'asc' ? aScore - bScore : bScore - aScore;
  });
  const topEvidence = rankedEvidence[0] || null;

  const outputMetrics = topEvidence
    ? {
        top_dimension: topEvidence.dimension,
        top_value: topEvidence.value,
        top_display_value: topEvidence.display_value ?? topEvidence.value,
        top_sessions_delta_pct: topEvidence.deltas?.sessions_delta_pct,
        top_orders_delta_pct: topEvidence.deltas?.orders_delta_pct,
        top_cvr_delta_pct: topEvidence.deltas?.cvr_delta_pct,
        top_atc_rate_delta_pct: topEvidence.deltas?.atc_rate_delta_pct,
        top_atc_sessions_delta_pct: topEvidence.deltas?.atc_sessions_delta_pct,
        top_current_sessions: topEvidence.current?.sessions,
        top_baseline_sessions: topEvidence.baseline?.sessions,
        top_current_orders: topEvidence.current?.orders,
        top_baseline_orders: topEvidence.baseline?.orders,
        top_current_atc_sessions: topEvidence.current?.atc_sessions,
        top_baseline_atc_sessions: topEvidence.baseline?.atc_sessions,
        top_current_atc_rate: topEvidence.current?.atc_rate,
        top_baseline_atc_rate: topEvidence.baseline?.atc_rate
      }
    : {};

  if (output_key) {
    outputMetrics[output_key] = formatBaselineList(rankedEvidence, {
      rankBy: rank_by,
      baseMetric: base_metric
    });
  }

  return {
    status: 'pass',
    delta: {
      metrics: outputMetrics,
      breakdowns: {
        [output_key || dimensionList[0]]: rankedEvidence
      }
    },
    next
  };
}

module.exports = RecursiveDimensionBreakdownNode;

function formatBaselineList(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return 'none';

  const { rankBy = 'delta', baseMetric = 'cvr' } = options;

  return entries.map((entry, idx) => {
    const label = entry.display_value ?? entry.value;
    const baselineCvr = formatPct((entry.baseline?.cvr || 0) * 100);
    const baselineSessions = entry.baseline?.sessions ?? 0;
    const currentSessions = entry.current?.sessions ?? 0;
    const baselineOrders = entry.baseline?.orders ?? 0;
    const currentOrders = entry.current?.orders ?? 0;
    const sessionsDelta = formatPct(entry.deltas?.sessions_delta_pct);
    const ordersDelta = formatPct(entry.deltas?.orders_delta_pct);

    const showSessionsOnly = rankBy === 'baseline_sessions' || baseMetric === 'sessions';
    const showOrdersOnly = rankBy === 'baseline_orders' || baseMetric === 'orders';

    const parts = [`${idx + 1}. ${label}`, `baseline CVR ${baselineCvr}`];

    if (showOrdersOnly) {
      parts.push(`orders ${baselineOrders} -> ${currentOrders} (${ordersDelta})`);
    } else if (showSessionsOnly) {
      parts.push(`sessions ${baselineSessions} -> ${currentSessions} (${sessionsDelta})`);
    } else {
      parts.push(`sessions ${baselineSessions} -> ${currentSessions} (${sessionsDelta})`);
      parts.push(`orders ${baselineOrders} -> ${currentOrders} (${ordersDelta})`);
    }

    return parts.join(' | ');
  }).join('\n');
}

function formatPct(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return 'unknown';
  }
  return `${Number(value).toFixed(2)}%`;
}
