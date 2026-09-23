const { STATES, REASONS, defaultRuntimeState, isAutomaticTrigger } = require('./defaults');
const { classifySeverity } = require('./severity');
const { isQuietMinute, effectiveElapsedMs } = require('./quietHours');

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizePrior(prior) {
  const base = defaultRuntimeState();
  if (!prior) return base;
  return {
    ...base,
    ...prior,
    state: Object.values(STATES).includes(prior.state) ? prior.state : STATES.NORMAL,
    cooldown: prior.cooldown?.started_at ? prior.cooldown : null,
    recovery: { ...base.recovery, ...(prior.recovery || {}) }
  };
}

function cooldownMinutesFor(state, config) {
  if (state === STATES.CRITICAL) return config.cooldown.critical_minutes;
  if (state === STATES.TRIGGERED) return config.cooldown.triggered_minutes;
  return 0;
}

// Picks the notification a transition is a candidate for, and which gates apply to
// it. Pure table lookup over spec §33 plus the recovery-evidence outcome.
//   cooldownState: whose cooldown duration gates this send (null = cooldown bypassed)
//   quietBypass:   true only for a direct NORMAL -> CRITICAL escalation
function resolveCandidate({ prev, next, recovery, automatic, requiredEvidence }) {
  if (next === STATES.NORMAL) {
    // T/C -> NORMAL is only the first piece of evidence and never sends. RECOVERY
    // can only come from a NORMAL -> NORMAL run that completes the evidence count,
    // and only an automatic run may complete it.
    if (prev === STATES.NORMAL && recovery.pending && automatic && recovery.evidence_count >= requiredEvidence) {
      return { reason: REASONS.RECOVERY, cooldownState: null, quietBypass: false };
    }
    return null;
  }

  if (next === STATES.CRITICAL) {
    if (prev === STATES.CRITICAL) {
      return { reason: REASONS.REMINDER, cooldownState: STATES.CRITICAL, quietBypass: false };
    }
    return {
      reason: REASONS.ESCALATION,
      cooldownState: null,
      quietBypass: prev === STATES.NORMAL
    };
  }

  // next === TRIGGERED
  if (prev === STATES.NORMAL) {
    return { reason: REASONS.INITIAL_TRIGGER, cooldownState: STATES.TRIGGERED, quietBypass: false };
  }
  if (prev === STATES.CRITICAL) {
    return { reason: REASONS.DE_ESCALATION, cooldownState: STATES.TRIGGERED, quietBypass: false };
  }
  return { reason: REASONS.REMINDER, cooldownState: STATES.TRIGGERED, quietBypass: false };
}

function nextRecovery({ prev, next, prior, automatic }) {
  if (next !== STATES.NORMAL) {
    return { pending: false, evidence_count: 0, from_state: null };
  }
  if (prev !== STATES.NORMAL) {
    // Recovery starts here. A manual run still flips the state (state always follows
    // the finding) but contributes no evidence.
    return { pending: true, evidence_count: automatic ? 1 : 0, from_state: prev };
  }
  if (prior.recovery.pending) {
    return {
      pending: true,
      evidence_count: prior.recovery.evidence_count + (automatic ? 1 : 0),
      from_state: prior.recovery.from_state || null
    };
  }
  return { pending: false, evidence_count: 0, from_state: null };
}

// Pure transition + notification decision (spec §29 steps 3-9). State is computed
// first and unconditionally; cooldown and quiet hours only ever decide
// notification.should_send. Plain objects in, plain objects out -- the caller owns
// persistence.
//
// finding: output of severity.resolveFindingValue (must be conclusive)
// config:  output of defaults.normalizeStateConfig
function evaluateState({ prior: rawPrior, finding, triggerType, now = new Date(), config, timezone = 'UTC' }) {
  const prior = normalizePrior(rawPrior);
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = nowDate.toISOString();
  const automatic = isAutomaticTrigger(triggerType);
  const requiredEvidence = config.recovery.required_evidence;

  const prev = prior.state;
  const next = classifySeverity(finding.value, config.thresholds);
  const recovery = nextRecovery({ prev, next, prior, automatic });
  const candidate = resolveCandidate({ prev, next, recovery, automatic, requiredEvidence });

  const quietActive = isQuietMinute(nowDate, config.quiet_hours, timezone);

  let cooldownActive = false;
  let effectiveElapsed = null;
  if (candidate?.cooldownState && prior.cooldown?.started_at) {
    const durationMs = cooldownMinutesFor(candidate.cooldownState, config) * 60 * 1000;
    effectiveElapsed = effectiveElapsedMs(prior.cooldown.started_at, nowDate, config.quiet_hours, timezone, durationMs);
    cooldownActive = durationMs > 0 && effectiveElapsed < durationMs;
  }

  let shouldSend = false;
  let suppressedBy = null;
  if (candidate) {
    if (cooldownActive) {
      suppressedBy = 'cooldown';
    } else if (quietActive && !candidate.quietBypass) {
      suppressedBy = 'quiet_hours';
    } else {
      shouldSend = true;
    }
  }

  let nextCooldown = prior.cooldown;
  let nextLastAlertAt = toIso(prior.last_alert_at);
  let nextRecoveryState = recovery;
  if (shouldSend) {
    nextLastAlertAt = nowIso;
    if (candidate.reason === REASONS.RECOVERY) {
      // A delivered recovery closes the incident: cooldown and evidence both reset,
      // so the next incident always opens with INITIAL_TRIGGER.
      nextCooldown = null;
      nextRecoveryState = { pending: false, evidence_count: 0, from_state: null };
    } else {
      nextCooldown = { state: next, duration_minutes: cooldownMinutesFor(next, config), started_at: nowIso };
    }
  }

  // An escalation ignores cooldown; for the audit trail, only call that a bypass when
  // the existing cooldown was actually still running.
  let cooldownBypassed = false;
  if (candidate?.reason === REASONS.ESCALATION && prior.cooldown?.started_at) {
    const priorDurationMs = (prior.cooldown.duration_minutes || 0) * 60 * 1000;
    cooldownBypassed = priorDurationMs > 0
      && effectiveElapsedMs(prior.cooldown.started_at, nowDate, config.quiet_hours, timezone, priorDurationMs) < priorDurationMs;
  }

  return {
    previous_state: prev,
    resulting_state: next,
    trigger_type: triggerType || null,
    automatic,
    evaluated_at: nowIso,
    finding: {
      metric: finding.metric,
      raw: finding.raw,
      value: finding.value,
      direction: finding.direction,
      severity: next,
      thresholds: { ...config.thresholds }
    },
    notification: {
      candidate_reason: candidate?.reason || null,
      should_send: shouldSend,
      reason: shouldSend ? candidate.reason : null,
      suppressed_by: suppressedBy
    },
    cooldown: {
      active: cooldownActive,
      bypassed: cooldownBypassed,
      applicable_state: candidate?.cooldownState || null,
      effective_elapsed_ms: effectiveElapsed
    },
    quiet_hours: { active: quietActive, bypassed: Boolean(candidate?.quietBypass && quietActive) },
    recovery: {
      pending: nextRecoveryState.pending,
      evidence_count: nextRecoveryState.evidence_count,
      required_evidence: requiredEvidence,
      from_state: shouldSend && candidate.reason === REASONS.RECOVERY ? recovery.from_state : nextRecoveryState.from_state
    },
    // What notification bookkeeping looked like before this run, so a failed SMTP
    // send can hand its cooldown (or pending recovery) back -- see
    // stateEngineService's rollback.
    prior_bookkeeping: {
      cooldown: prior.cooldown,
      last_alert_at: toIso(prior.last_alert_at)
    },
    next: {
      state: next,
      cooldown: nextCooldown,
      recovery: { ...nextRecoveryState, required_evidence: requiredEvidence },
      last_evaluated_at: nowIso,
      last_alert_at: nextLastAlertAt
    }
  };
}

module.exports = {
  evaluateState,
  resolveCandidate,
  cooldownMinutesFor
};
