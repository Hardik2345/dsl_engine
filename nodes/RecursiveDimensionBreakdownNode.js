const queryBuilder = require('../sql/QueryBuilder');
const queryExecutor = require('../sql/QueryExecutor');

async function RecursiveDimensionBreakdownNode(def, context) {
  const {
    dimension,
    dimensions = [],
    stop_conditions = {},
    next
  } = def;

  const {
    max_depth = 1,
    min_sessions = 0,
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
    let totalImpact = 0;

    for (const row of result.rows) {
      const { baseline_sessions } = row;
      if (baseline_sessions > 0) {
        totalBaselineSessions += baseline_sessions;
      }
    }

    if (totalBaselineSessions === 0) return;

    // ---------- Phase 1: collect candidates ----------
    for (const row of result.rows) {
      const {
        dimension_value,
        current_orders,
        baseline_orders,
        current_sessions,
        baseline_sessions
      } = row;

      if (current_sessions < min_sessions) continue;
      if (baseline_sessions === 0) continue;

      const current_cvr =
        current_sessions === 0 ? null : current_orders / current_sessions;

      const baseline_cvr =
        baseline_sessions === 0 ? null : baseline_orders / baseline_sessions;

      if (current_cvr == null || baseline_cvr == null) continue;
      if (baseline_cvr === 0) continue;

      const cvr_delta_pct =
        ((current_cvr - baseline_cvr) / baseline_cvr) * 100;

      if (cvr_delta_pct >= 0) continue;

      const segmentImpact =
        (current_cvr - baseline_cvr) *
        (baseline_sessions / totalBaselineSessions);

      if (segmentImpact >= 0) continue;

      totalImpact += segmentImpact;

      candidates.push({
        dimension: activeDimension,
        value: dimension_value,
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
          cvr_delta_pct
        },
        segmentImpact
      });
    }

    if (!candidates.length || totalImpact === 0) return;

    for (const entry of candidates) {
      const contribution_pct =
        Math.abs(entry.segmentImpact) /
        Math.abs(totalImpact) * 100;

      if (contribution_pct < min_impact_pct) {
        entry.contribution_pct = contribution_pct;
        continue;
      }

      entry.contribution_pct = contribution_pct;
    }

    const filteredCandidates = candidates.filter(
      entry => entry.contribution_pct >= min_impact_pct
    );

    if (!filteredCandidates.length) return;

    // ---------- Phase 2: rank ----------
    filteredCandidates.sort(
      (a, b) => a.segmentImpact - b.segmentImpact
    );

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
    if (!existing || entry.segmentImpact < existing.segmentImpact) {
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
