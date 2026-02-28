const {
  INSIGHT_TOP_TOKEN_COUNT,
  INSIGHT_TOP_TOKEN_SUFFIXES,
  DIMENSION_LABELS,
} = require('../constants/insightTokens');

function computeEvidenceScore(entry) {
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

  if (metric === 'atc_rate') {
    const pct = entry.deltas?.atc_rate_delta_pct;
    const share = entry.sessionShare ?? 0;
    return pct == null ? -Infinity : Math.abs(pct) * share;
  }

  if (metric === 'atc_sessions') {
    const pct = entry.deltas?.atc_sessions_delta_pct;
    const share = entry.sessionShare ?? 0;
    return pct == null ? -Infinity : Math.abs(pct) * share;
  }

  const pct = entry.deltas?.cvr_delta_pct;
  const share = entry.sessionShare ?? 0;
  return pct == null ? -Infinity : Math.abs(pct) * share;
}

function buildTopEvidenceTokens(selected) {
  const tokens = {};
  const list = Array.isArray(selected) ? selected : [];

  for (let index = 0; index < INSIGHT_TOP_TOKEN_COUNT; index++) {
    const prefix = `top${index + 1}`;
    const entry = list[index];

    INSIGHT_TOP_TOKEN_SUFFIXES.forEach((suffix) => {
      const key = `${prefix}_${suffix}`;
      tokens[key] = resolveTopTokenValue(entry, suffix);
    });
  }

  return tokens;
}

function resolveTopTokenValue(entry, suffix) {
  switch (suffix) {
    case 'dimension':
      return entry?.dimension;
    case 'dimension_label':
      return formatDimensionLabel(entry?.dimension);
    case 'value':
      return formatDisplayValue(entry);
    case 'cvr_delta_pct_fmt':
      return formatPct(entry?.deltas?.cvr_delta_pct);
    case 'atc_rate_delta_pct_fmt':
      return formatPct(entry?.deltas?.atc_rate_delta_pct);
    case 'sessions_delta_pct':
      return entry?.deltas?.sessions_delta_pct;
    case 'sessions_delta_pct_fmt':
      return formatPct(entry?.deltas?.sessions_delta_pct);
    case 'orders_delta_pct':
      return entry?.deltas?.orders_delta_pct;
    case 'orders_delta_pct_fmt':
      return formatPct(entry?.deltas?.orders_delta_pct);
    default:
      return undefined;
  }
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
  return DIMENSION_LABELS[dimension] || dimension;
}

function makeEvidenceKey(entry) {
  if (!entry) return 'unknown';
  const dimension = entry.dimension || 'unknown_dimension';
  const value = entry.value ?? entry.display_value ?? 'unknown_value';
  return `${dimension}::${String(value)}`;
}

module.exports = {
  computeEvidenceScore,
  buildTopEvidenceTokens,
  formatPct,
  formatDisplayValue,
  formatDimensionLabel,
  makeEvidenceKey,
};
