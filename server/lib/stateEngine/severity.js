const { STATES } = require('./defaults');

function toFiniteNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Sign contract: context.metrics[metric] is a signed percent (cvr_delta_pct = -17
// means CVR fell 17%). Thresholds are magnitudes, so the raw delta is normalized to
// "how bad is it in the configured direction":
//   drop     -> -raw   (-17 -> 17; +5 -> -5, i.e. comfortably NORMAL)
//   rise     ->  raw
//   absolute -> |raw|
// `0 - raw` rather than `-raw` so a zero delta normalizes to 0, not -0.
function normalizeFindingValue(raw, direction) {
  if (direction === 'rise') return raw;
  if (direction === 'absolute') return Math.abs(raw);
  return 0 - raw;
}

// Returns conclusive: false when the run never produced a usable value, which the
// caller treats as "no observation" -- no state change, no recovery evidence.
function resolveFindingValue(context, finding = {}) {
  const metric = finding.metric;
  const raw = context?.metrics?.[metric];
  const numeric = toFiniteNumber(raw);
  if (!metric || numeric == null) {
    return { metric: metric || null, raw: raw ?? null, value: null, direction: finding.direction, conclusive: false };
  }
  return {
    metric,
    raw: numeric,
    value: normalizeFindingValue(numeric, finding.direction),
    direction: finding.direction,
    conclusive: true
  };
}

// Inclusive boundaries: value == normal is TRIGGERED, value == critical is CRITICAL.
function classifySeverity(value, thresholds) {
  if (value >= thresholds.critical) return STATES.CRITICAL;
  if (value >= thresholds.normal) return STATES.TRIGGERED;
  return STATES.NORMAL;
}

module.exports = {
  resolveFindingValue,
  normalizeFindingValue,
  classifySeverity
};
