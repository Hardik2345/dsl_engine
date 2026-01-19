function InsightNode(def, context) {
  const { template = {}, persist } = def;
  const { metrics = {}, breakdowns = {} } = context;

  // --- Find top contributing breakdown (global) ---
  let topEvidence = null;

  Object.values(breakdowns).forEach(list => {
    list.forEach(entry => {
      if (entry?.segmentImpact == null) return;
      if (!topEvidence || entry.segmentImpact < topEvidence.segmentImpact) {
        topEvidence = entry;
      }
    });
  });

  if (!topEvidence) {
    Object.values(breakdowns).forEach(list => {
      list.forEach(entry => {
        if (
          !topEvidence ||
          entry.contribution_pct > topEvidence.contribution_pct
        ) {
          topEvidence = entry;
        }
      });
    });
  }

  // --- Build template context ---
  const templateContext = {
    ...metrics,
    dimension: topEvidence?.dimension,
    value: topEvidence?.value,
    contribution_pct: topEvidence?.contribution_pct,
    contribution_pct_fmt: formatPct(topEvidence?.contribution_pct),
    confidence_score: computeConfidence(metrics, topEvidence),
    cvr_delta_pct_fmt: formatPct(metrics.cvr_delta_pct),
    sessions_delta_pct_fmt: formatPct(metrics.sessions_delta_pct),
    orders_delta_pct_fmt: formatPct(metrics.orders_delta_pct),
    current_cvr_pct: formatPct((metrics.current_cvr || 0) * 100),
    baseline_cvr_pct: formatPct((metrics.baseline_cvr || 0) * 100),
    top_current_cvr_pct: formatPct((topEvidence?.current?.cvr || 0) * 100),
    top_baseline_cvr_pct: formatPct((topEvidence?.baseline?.cvr || 0) * 100),
    top_cvr_delta_pct_fmt: formatPct(topEvidence?.deltas?.cvr_delta_pct),
    top_current_sessions: topEvidence?.current?.sessions,
    top_baseline_sessions: topEvidence?.baseline?.sessions,
    top_current_orders: topEvidence?.current?.orders,
    top_baseline_orders: topEvidence?.baseline?.orders
  };

  // --- Render output ---
  const summary = renderTemplate(template.summary, templateContext);
  const details = Array.isArray(template.details)
    ? template.details.map(line => renderTemplate(line, templateContext))
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

  const impact = Math.min(Math.abs(evidence.contribution_pct) / 100, 1);
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
