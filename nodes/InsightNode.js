const {
  computeEvidenceScore,
  buildTopEvidenceTokens,
  formatPct,
  formatDisplayValue,
  formatDimensionLabel,
  makeEvidenceKey,
} = require('../server/lib/insightUtils');
const { renderInsightEmail } = require('../server/lib/renderInsightEmail');
const { sendEmail } = require('../server/services/emailService');

async function InsightNode(def, context) {
  const { template = {}, persist, output_key, email } = def;
  const { metrics = {}, breakdowns = {} } = context;

  // Handle simple string templates
  const templateObj = typeof template === 'string' 
    ? { summary: template, details: [] }
    : template;

  // --- Find top contributing breakdowns (global) ---
  const flatEvidence = [];
  if (output_key && Array.isArray(breakdowns[output_key])) {
    breakdowns[output_key].forEach(entry => {
      flatEvidence.push(entry);
    });
  } else {
    Object.values(breakdowns).forEach(list => {
      if (!Array.isArray(list)) return;
      list.forEach(entry => {
        flatEvidence.push(entry);
      });
    });
  }

  const scored = flatEvidence
    .map(entry => ({ entry, score: computeEvidenceScore(entry) }))
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
  const topEvidenceTokens = buildTopEvidenceTokens(selected);

  // --- Build template context ---
  const templateContext = {
    ...metrics,
    output_key: output_key || '',
    dimension: topEvidence?.dimension,
    dimension_label: formatDimensionLabel(topEvidence?.dimension),
    value: formatDisplayValue(topEvidence),
    ...topEvidenceTokens,
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

  let emailResult = null;
  if (email?.enabled) {
    const renderedEmail = renderInsightEmail({
      insight,
      workflowId: context?.workflow_id || context?.meta?.workflowId,
      nodeId: def.id
    });

    emailResult = await sendEmail({
      to: email.to,
      subject: renderedEmail.subject,
      html: renderedEmail.html,
      text: renderedEmail.text
    });
  }

  const scratchDelta = {
    finalInsight: insight
  };
  if (persist) {
    // implement db persistence here
    scratchDelta.persistedInsight = insight;
  }
  if (emailResult) {
    scratchDelta.finalInsightEmail = {
      nodeId: def.id,
      ...emailResult
    };
  }

  return {
    status: 'pass',
    delta: {
      scratch: scratchDelta
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
    if (val === undefined || val === null) return 'unknown';
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val.toFixed(2);
    }
    return String(val);
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
