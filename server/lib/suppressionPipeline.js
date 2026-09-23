const { computeEvidenceScore } = require('./insightUtils');

const DEFAULT_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DURATION_UNIT_MS = { ms: 1, s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

// Parses design-doc-shaped duration strings ("24h", "30s", "7d") or a plain
// millisecond number, as used by notify_policy.min_interval. Falls back rather
// than throwing on anything unparsable, since this only ever feeds a cooldown
// window -- a malformed value should degrade to the safe default, not crash a run.
function parseDurationMs(value, fallbackMs = DEFAULT_MIN_INTERVAL_MS) {
  if (value == null || value === '') return fallbackMs;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i.exec(String(value).trim());
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  return amount * (DURATION_UNIT_MS[unit] ?? 1);
}

function isCriticalBypassCandidate(candidate) {
  return Boolean(candidate.criticalBypass);
}

function withinQuietHours({ quietHours, now, timezone }) {
  if (!quietHours || !quietHours.start || !quietHours.end) return false;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone || 'UTC'
  });
  const currentHHMM = formatter.format(now).replace(/[^0-9:]/g, '');
  const { start, end } = quietHours;
  if (start <= end) return currentHHMM >= start && currentHHMM < end;
  // window wraps midnight, e.g. 22:00-07:00
  return currentHHMM >= start || currentHHMM < end;
}

// Design doc §7. Evaluated per candidate notification, in this exact order --
// order matters: human intent outranks policy, and caps apply after significance
// so they consume real notifications rather than already-suppressed ones. Pure
// function: returns a decision, performs no ledger insert and no send itself, so
// it's testable with plain objects (design doc's own stated intent for this piece).
//
// candidate = {
//   transition, criticalBypass, dryRun, conclusive,
//   humanState: { muted, snoozed: { until }, acked },
//   flapDemoted, cooldownOk, evidenceScore,
//   quietHours: { start, end }, timezone, now,
//   burstRank, burstCap, rateUsed, rateCap,
//   contentHash, priorContentHash,
// }
function evaluateSuppression(candidate) {
  if (candidate.dryRun) {
    return { action: 'suppress', reason: 'dry_run' };
  }

  if (candidate.conclusive === false) {
    return { action: 'suppress', reason: 'inconclusive' };
  }

  if (!candidate.transition || candidate.transition === 'none' || candidate.transition === 'inconclusive') {
    return { action: 'suppress', reason: 'no_transition' };
  }

  const bypass = isCriticalBypassCandidate(candidate);

  if (candidate.humanState?.muted) {
    return { action: 'suppress', reason: 'muted' };
  }
  if (candidate.humanState?.snoozed?.until && new Date(candidate.humanState.snoozed.until) > candidate.now) {
    return { action: 'hold', reason: 'snoozed', heldUntil: candidate.humanState.snoozed.until };
  }
  if (candidate.humanState?.acked && candidate.transition !== 'escalation' && candidate.transition !== 'resolved') {
    return { action: 'suppress', reason: 'acked' };
  }

  if (!bypass && candidate.flapDemoted) {
    return { action: 'digest', reason: 'flapping_digest' };
  }

  if (!bypass && candidate.cooldownOk === false) {
    return { action: 'suppress', reason: 'cooldown' };
  }

  if (candidate.transition === 'escalation' && candidate.isSignificant === false) {
    return { action: 'suppress', reason: 'not_significant' };
  }

  if (!bypass && withinQuietHours(candidate)) {
    return { action: 'hold', reason: 'quiet_hours' };
  }

  if (candidate.burstCap != null && candidate.burstRank != null && candidate.burstRank >= candidate.burstCap) {
    return { action: 'digest', reason: 'burst_cap' };
  }

  if (candidate.rateCap != null && candidate.rateUsed != null && candidate.rateUsed >= candidate.rateCap) {
    return { action: 'digest', reason: 'rate_cap' };
  }

  if (candidate.contentHash && candidate.priorContentHash && candidate.contentHash === candidate.priorContentHash) {
    return { action: 'suppress', reason: 'duplicate_content' };
  }

  return { action: 'send', reason: null };
}

// Ranks candidates for burst-cap purposes using the same impact score already used
// for insight top-evidence selection (server/lib/insightUtils.js:7), so burst
// ranking and "what mattered most" ranking agree.
function rankByEvidenceScore(candidates) {
  return [...candidates].sort((a, b) => computeEvidenceScore(b.entry || {}) - computeEvidenceScore(a.entry || {}));
}

module.exports = {
  evaluateSuppression,
  rankByEvidenceScore,
  withinQuietHours,
  parseDurationMs,
  DEFAULT_MIN_INTERVAL_MS,
};
