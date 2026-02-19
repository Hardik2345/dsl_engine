function InsightNode(def, context) {
  const { template = {}, persist } = def;
  const { metrics = {}, breakdowns = {} } = context;

  // Handle simple string templates
  const templateObj = typeof template === 'string' 
    ? { summary: template, details: [] }
    : template;

  // --- Find top contributing breakdowns (global) ---
  const flatEvidence = [];
  Object.values(breakdowns).forEach(list => {
    list.forEach(entry => {
      flatEvidence.push(entry);
    });
  });

  const computeScore = (entry) => {
    const metric = entry.base_metric || 'cvr';

    if (metric === 'orders') {
      const pct = entry.deltas?.orders_delta_pct;
      const share = entry.orderShare ?? entry.sessionShare ?? 0;
      return pct == null ? -Infinity : Math.abs(pct) * share;
    }

    if (metric === 'sessions') {
      const pct = entry.deltas?.sessions_delta_pct;
      return pct == null ? -Infinity : Math.abs(pct);
    }

    // default cvr
    const pct = entry.deltas?.cvr_delta_pct;
    const share = entry.sessionShare ?? 0;
    return pct == null ? -Infinity : Math.abs(pct) * share;
  };

  const scored = flatEvidence
    .map(entry => ({ entry, score: computeScore(entry) }))
    .sort((a, b) => b.score - a.score);

  const productCandidates = scored
    .map(item => item.entry)
    .filter(entry => entry.dimension === 'product_id');

  const selected = [];
  const selectedKeys = new Set();

  const addIfUnique = (entry) => {
    if (!entry) return false;
    const key = makeEvidenceKey(entry);
    if (selectedKeys.has(key)) return false;
    selected.push(entry);
    selectedKeys.add(key);
    return true;
  };

  if (productCandidates.length) {
    addIfUnique(productCandidates[0]);
  }

  const pool = scored.map(item => item.entry);
  for (const entry of pool) {
    if (selected.length >= 4) break;
    addIfUnique(entry);
  }

  const matchedBreakdown = context?.scratch?.matched_breakdown || null;
  const topEvidence = matchedBreakdown || selected[0] || null;

  // --- Build template context ---
  const templateContext = {
    ...metrics,
    dimension: topEvidence?.dimension,
    dimension_label: formatDimensionLabel(topEvidence?.dimension),
    value: formatDisplayValue(topEvidence),
    top1_dimension: selected[0]?.dimension,
    top1_dimension_label: formatDimensionLabel(selected[0]?.dimension),
    top1_value: formatDisplayValue(selected[0]),
    top1_cvr_delta_pct_fmt: formatPct(selected[0]?.deltas?.cvr_delta_pct),
    top1_atc_rate_delta_pct_fmt: formatPct(selected[0]?.deltas?.atc_rate_delta_pct),
    top1_sessions_delta_pct: selected[0]?.deltas?.sessions_delta_pct,
    top1_sessions_delta_pct_fmt: formatPct(selected[0]?.deltas?.sessions_delta_pct),
    top1_orders_delta_pct: selected[0]?.deltas?.orders_delta_pct,
    top1_orders_delta_pct_fmt: formatPct(selected[0]?.deltas?.orders_delta_pct),
    top2_dimension: selected[1]?.dimension,
    top2_dimension_label: formatDimensionLabel(selected[1]?.dimension),
    top2_value: formatDisplayValue(selected[1]),
    top2_cvr_delta_pct_fmt: formatPct(selected[1]?.deltas?.cvr_delta_pct),
    top2_atc_rate_delta_pct_fmt: formatPct(selected[1]?.deltas?.atc_rate_delta_pct),
    top2_sessions_delta_pct: selected[1]?.deltas?.sessions_delta_pct,
    top2_sessions_delta_pct_fmt: formatPct(selected[1]?.deltas?.sessions_delta_pct),
    top2_orders_delta_pct: selected[1]?.deltas?.orders_delta_pct,
    top2_orders_delta_pct_fmt: formatPct(selected[1]?.deltas?.orders_delta_pct),
    top3_dimension: selected[2]?.dimension,
    top3_dimension_label: formatDimensionLabel(selected[2]?.dimension),
    top3_value: formatDisplayValue(selected[2]),
    top3_cvr_delta_pct_fmt: formatPct(selected[2]?.deltas?.cvr_delta_pct),
    top3_atc_rate_delta_pct_fmt: formatPct(selected[2]?.deltas?.atc_rate_delta_pct),
    top3_sessions_delta_pct: selected[2]?.deltas?.sessions_delta_pct,
    top3_sessions_delta_pct_fmt: formatPct(selected[2]?.deltas?.sessions_delta_pct),
    top3_orders_delta_pct: selected[2]?.deltas?.orders_delta_pct,
    top3_orders_delta_pct_fmt: formatPct(selected[2]?.deltas?.orders_delta_pct),
    top4_dimension: selected[3]?.dimension,
    top4_dimension_label: formatDimensionLabel(selected[3]?.dimension),
    top4_value: formatDisplayValue(selected[3]),
    top4_cvr_delta_pct_fmt: formatPct(selected[3]?.deltas?.cvr_delta_pct),
    top4_atc_rate_delta_pct_fmt: formatPct(selected[3]?.deltas?.atc_rate_delta_pct),
    top4_sessions_delta_pct: selected[3]?.deltas?.sessions_delta_pct,
    top4_sessions_delta_pct_fmt: formatPct(selected[3]?.deltas?.sessions_delta_pct),
    top4_orders_delta_pct: selected[3]?.deltas?.orders_delta_pct,
    top4_orders_delta_pct_fmt: formatPct(selected[3]?.deltas?.orders_delta_pct),
    confidence_score: computeConfidence(metrics, topEvidence),
    cvr_delta_pct_fmt: formatPct(metrics.cvr_delta_pct),
    sessions_delta_pct_fmt: formatPct(metrics.sessions_delta_pct),
    orders_delta_pct_fmt: formatPct(metrics.orders_delta_pct),
    current_cvr_pct: formatPct((metrics.current_cvr || 0) * 100),
    baseline_cvr_pct: formatPct((metrics.baseline_cvr || 0) * 100),
    top_current_cvr_pct: formatPct((topEvidence?.current?.cvr || 0) * 100),
    top_baseline_cvr_pct: formatPct((topEvidence?.baseline?.cvr || 0) * 100),
    top_cvr_delta_pct_fmt: formatPct(topEvidence?.deltas?.cvr_delta_pct),
    top_atc_rate_delta_pct_fmt: formatPct(topEvidence?.deltas?.atc_rate_delta_pct),
    top_atc_sessions_delta_pct_fmt: formatPct(topEvidence?.deltas?.atc_sessions_delta_pct),
    top_current_sessions: topEvidence?.current?.sessions,
    top_baseline_sessions: topEvidence?.baseline?.sessions,
    top_current_orders: topEvidence?.current?.orders,
    top_baseline_orders: topEvidence?.baseline?.orders,
    top_current_atc_sessions: topEvidence?.current?.atc_sessions,
    top_baseline_atc_sessions: topEvidence?.baseline?.atc_sessions,
    top_current_atc_rate_pct: formatPct((topEvidence?.current?.atc_rate || 0) * 100),
    top_baseline_atc_rate_pct: formatPct((topEvidence?.baseline?.atc_rate || 0) * 100),
    top_sessions_delta_pct_fmt: formatPct(topEvidence?.deltas?.sessions_delta_pct)
  };

  // --- Render output ---
  const summary = renderTemplate(templateObj.summary, templateContext);
  const details = Array.isArray(templateObj.details)
    ? templateObj.details.map(line => renderTemplate(line, templateContext))
    : [];

  const insight = {
    summary,
    details,
    confidence: templateContext.confidence_score
  };

  // --- Persist (optional) ---
  if (persist) {
    // implement db persistance here
    context.scratch = {
      ...(context.scratch || {}),
      persistedInsight: insight
    };
  }

  return {
    status: 'pass',
    delta: {
      scratch: {
        finalInsight: insight
      }
    },
    next: def.next
  };
}

module.exports = InsightNode;

/* ----------------- helpers ----------------- */

function renderTemplate(str, ctx) {
  if (!str || typeof str !== 'string') return '';

  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = ctx[key];
    return val === undefined || val === null ? 'unknown' : String(val);
  });
}

function computeConfidence(metrics, evidence) {
  if (!evidence) return 0.3;

  const impact = Math.min(Math.abs(evidence.sessionShare || 0), 1);
  const trafficWeight = Math.min(
    (evidence.current?.sessions || 0) / 1000,
    1
  );

  // Simple bounded heuristic (0.3 → 0.9)
  return Number((0.3 + 0.6 * impact * trafficWeight).toFixed(2));
}

function formatPct(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return 'unknown';
  }
  return `${Number(value).toFixed(2)}%`;
}

function formatDisplayValue(entry) {
  if (!entry) return undefined;
  return entry.display_value ?? entry.value;
}

function formatDimensionLabel(dimension) {
  if (!dimension) return undefined;
  if (dimension === 'product_id') return 'Product';
  return dimension;
}

function makeEvidenceKey(entry) {
  if (!entry) return 'unknown';
  const dimension = entry.dimension || 'unknown_dimension';
  const value = entry.value ?? entry.display_value ?? 'unknown_value';
  return `${dimension}::${String(value)}`;
}
