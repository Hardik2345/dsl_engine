const crypto = require('crypto');

const UNKNOWN_VALUE = '__unknown__';

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

// Design doc §5.4 rule 3: null/empty/literal "unknown" all collapse to one bucket.
// Deliberately stricter than server/lib/insightUtils.js's makeEvidenceKey, which
// falls back to display_value when value is missing -- a fingerprint must never key
// on a human-editable label (rule 1), so no such fallback exists here.
function normalizeDimensionValue(rawValue) {
  if (rawValue === null || rawValue === undefined) return UNKNOWN_VALUE;
  const asString = String(rawValue).trim();
  if (!asString || asString.toLowerCase() === 'unknown') return UNKNOWN_VALUE;
  return asString;
}

// Design doc §5.4 rule 4: numeric-like ids normalize to string form so 123 and "123"
// never split into two findings. normalizeDimensionValue's String() coercion already
// achieves this for any JS number, so this exists mainly to document the intent and
// give rule 4 its own visible seam in case a stricter check is needed later.
function normalizeNumericLikeValue(rawValue) {
  return normalizeDimensionValue(rawValue);
}

// Design doc §5.4 rule 2: landing_page_path normalization -- strip query string and
// fragment, collapse duplicate slashes, strip a trailing slash, lowercase the path.
function normalizeLandingPagePath(rawValue) {
  const normalized = normalizeDimensionValue(rawValue);
  if (normalized === UNKNOWN_VALUE) return UNKNOWN_VALUE;

  let path = normalized.split('?')[0].split('#')[0];
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  path = path.toLowerCase();
  return path || UNKNOWN_VALUE;
}

function normalizeValueForDimension(dimension, rawValue) {
  if (dimension === 'landing_page_path') return normalizeLandingPagePath(rawValue);
  if (dimension === 'product_id') return normalizeNumericLikeValue(rawValue);
  return normalizeDimensionValue(rawValue);
}

function normalizePath(path) {
  if (!Array.isArray(path)) return [];
  return path.map((item) => ({
    dimension: item?.dimension || UNKNOWN_VALUE,
    value: normalizeValueForDimension(item?.dimension, item?.value)
  }));
}

// Design doc §5.3: default scope is per-workflow. `windowMode` is included by
// default (include_window_mode: true) so an hourly and a daily schedule on the same
// workflow never share one suppression stream.
function computeScopeKey({ tenantId, workflowId, stateScope = {}, windowMode }) {
  const mode = stateScope.mode || 'workflow';
  const includeWindowMode = stateScope.includeWindowMode !== false;
  const windowSuffix = includeWindowMode && windowMode ? `::${windowMode}` : '';

  if (mode === 'tenant_alert_type' && stateScope.alertType) {
    return `${tenantId}/alert:${stateScope.alertType}${windowSuffix}`;
  }
  if (mode === 'group' && stateScope.group) {
    return `${tenantId}/group:${stateScope.group}${windowSuffix}`;
  }
  return `${tenantId}/${workflowId}${windowSuffix}`;
}

// Design doc §5.1-5.2. `entry` is one row from context.breakdowns[outputKey], the
// same shape produced by RecursiveDimensionBreakdownNode. Deliberately excludes
// magnitudes, timestamps, runId, confidence, display_value and sessionShare -- any
// of those would make every observation a new finding.
function computeFingerprint({ entry, metric, direction, outputKey, ruleId, scopeKey }) {
  return {
    scopeKey,
    metric: metric || entry?.base_metric || 'cvr',
    direction: direction || 'drop',
    outputKey: outputKey || null,
    ruleId: ruleId || null,
    dimension: entry?.dimension || UNKNOWN_VALUE,
    value: normalizeValueForDimension(entry?.dimension, entry?.value),
    path: normalizePath(entry?.path)
  };
}

function computeFingerprintHash(fingerprint) {
  return sha1(canonicalJson(fingerprint));
}

function computeStateKey(scopeKey, fingerprintHash) {
  return `${scopeKey}:${fingerprintHash}`;
}

module.exports = {
  computeScopeKey,
  computeFingerprint,
  computeFingerprintHash,
  computeStateKey,
  normalizeValueForDimension,
  normalizeLandingPagePath,
  UNKNOWN_VALUE,
};
