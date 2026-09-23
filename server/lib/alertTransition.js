// Pure transition logic per docs/state-based-alerting-design.md §6. No DB access --
// plain objects in (a prior AlertState-shaped snapshot, or null; one observation),
// plain objects out (the next state snapshot plus a transition label). The caller
// (server/services/notificationService.js) owns loading/saving AlertState.

const DEFAULT_FOR_OBSERVATIONS = { cron: 2, event: 1 };
const DEFAULT_CLEAR_AFTER_OBSERVATIONS = 2;
// Phase 4: flap window default, policy-overridable via policy.flap.window_ms.
// The max_episodes threshold check itself is a delivery-policy decision, not a
// state-computation one, so it stays in notificationService.js (which consumes
// flapCount/flapWindowStartedAt written here) -- only the counting happens here.
const FLAP_WINDOW_MS_DEFAULT = 72 * 60 * 60 * 1000;
// Phase 4: default severity ladder. A workflow with no severity_tiers declared
// never populates observation.severityTier, so tierRank returns -1 for it and the
// tier-crossing check below never fires -- existing behavior is unaffected.
const DEFAULT_TIER_ORDER = ['warning', 'critical', 'paging'];

function tierRank(tier, order) {
  if (!tier) return -1;
  return order.indexOf(tier);
}

// design §6.5: which run outcomes are conclusive observations at all, and if
// conclusive, whether they represent a breach or a clean reading. A node-level
// `fail` upstream of the finding is inconclusive, same as a terminated/failed run --
// none of these may resolve or open a finding.
function classifyConclusiveness({ runStatus, breaching }) {
  if (runStatus === 'terminated' || runStatus === 'failed' || runStatus === 'dead_letter') {
    return { conclusive: false };
  }
  if (runStatus === 'completed') {
    return { conclusive: true, breaching: Boolean(breaching) };
  }
  return { conclusive: false };
}

function defaultForObservations(triggerType) {
  return DEFAULT_FOR_OBSERVATIONS[triggerType] ?? DEFAULT_FOR_OBSERVATIONS.event;
}

function isCriticalSeverity(severityTier) {
  return severityTier === 'critical';
}

// design §6.3/§6.4. `prior` is the previous AlertState-shaped snapshot (or null/
// {status:'absent'} for a fingerprint never seen before). `observation` describes
// what this run found for this specific finding.
//
// observation = {
//   runStatus,                 // 'completed' | 'terminated' | 'failed' | 'dead_letter'
//   breaching,                 // boolean, only meaningful when runStatus === 'completed'
//   severityTier,               // optional: 'critical' | 'warning' | null
//   magnitude,                  // the metric value driving significance comparisons
//   triggerType,                 // 'cron' | 'event', picks the for_observations default
//   observationKey,
//   policy: { for_observations, clear_after_observations, significance: {delta_pct} }
// }
function computeTransition(prior, observation) {
  const priorStatus = prior?.status || 'absent';
  const policy = observation.policy || {};
  const forObservations = policy.for_observations ?? defaultForObservations(observation.triggerType);
  const clearAfterObservations = policy.clear_after_observations ?? DEFAULT_CLEAR_AFTER_OBSERVATIONS;
  const significanceDeltaPct = policy.significance?.delta_pct ?? 25;

  const { conclusive, breaching } = classifyConclusiveness(observation);

  if (!conclusive) {
    const inconclusiveStreak = (prior?.inconclusiveStreak || 0) + 1;
    return {
      transition: 'inconclusive',
      notify: false,
      nextState: {
        ...prior,
        status: priorStatus === 'absent' ? 'absent' : priorStatus,
        consecutiveBreach: prior?.consecutiveBreach || 0,
        consecutiveClean: prior?.consecutiveClean || 0,
        inconclusiveStreak,
        lastSeenAt: observation.observedAt,
        lastObservationKey: observation.observationKey,
      }
    };
  }

  const isCriticalBypass = isCriticalSeverity(observation.severityTier)
    && (priorStatus === 'absent' || prior?.currentEpisode?.peakSeverityTier !== 'critical');

  if (priorStatus === 'absent' || priorStatus === 'resolved' || priorStatus === 'stale') {
    if (!breaching) {
      // A clean reading breaks the streak -- "consecutive" must mean consecutive,
      // or for_observations stops actually requiring N in a row.
      return {
        transition: 'none',
        notify: false,
        nextState: {
          ...prior,
          status: priorStatus === 'absent' ? 'absent' : priorStatus,
          consecutiveBreach: 0,
          consecutiveClean: prior?.consecutiveClean || 0,
          inconclusiveStreak: 0,
          lastSeenAt: observation.observedAt,
          lastObservationKey: observation.observationKey,
        }
      };
    }

    const consecutiveBreach = (priorStatus === 'absent' ? (prior?.consecutiveBreach || 0) : 0) + 1;
    const opensNow = isCriticalBypass || consecutiveBreach >= forObservations;

    if (!opensNow) {
      return {
        transition: 'none',
        notify: false,
        nextState: {
          ...prior,
          status: 'absent',
          consecutiveBreach,
          consecutiveClean: prior?.consecutiveClean || 0,
          inconclusiveStreak: 0,
          lastSeenAt: observation.observedAt,
          lastObservationKey: observation.observationKey,
        }
      };
    }

    const isRecurrence = priorStatus === 'resolved'
      && withinRecurrenceWindow(prior, observation, policy.recurrence_window_ms);

    // Outside the recurrence window (or never seen before), this is treated as a
    // wholly unrelated occurrence -- episode counting starts over rather than
    // continuing the old episode's count (design §5.3's framing: "reset conceptually").
    const episodeCount = isRecurrence ? (prior?.episodeCount || 0) + 1 : 1;

    // Phase 4: flap write-side. Counts raw episode-opens in a rolling window,
    // independent of episodeCount's recurrence-window semantics -- flap cares about
    // "how many times has this specific finding opened recently" regardless of
    // whether each open counts as a "recurrence" of the same resolved episode.
    // Deliberately NOT touched on a `resolved` transition elsewhere in this
    // function -- flap state should decay only by window expiry, since rapid
    // open/resolve cycling is exactly what flapping means.
    const flapWindowMs = policy.flap?.window_ms ?? FLAP_WINDOW_MS_DEFAULT;
    const observedAtMs = new Date(observation.observedAt).getTime();
    const flapWindowActive = prior?.flapWindowStartedAt
      && (observedAtMs - new Date(prior.flapWindowStartedAt).getTime()) <= flapWindowMs;
    const flapCount = (flapWindowActive ? (prior?.flapCount || 0) : 0) + 1;
    const flapWindowStartedAt = flapWindowActive ? prior.flapWindowStartedAt : observation.observedAt;

    return {
      transition: isRecurrence ? 'recurrence' : 'new',
      notify: true,
      criticalBypass: isCriticalBypass,
      nextState: {
        status: 'active',
        firstSeenAt: isRecurrence ? prior.firstSeenAt : observation.observedAt,
        lastSeenAt: observation.observedAt,
        lastObservationKey: observation.observationKey,
        consecutiveBreach,
        consecutiveClean: 0,
        inconclusiveStreak: 0,
        episodeCount,
        flapCount,
        flapWindowStartedAt,
        currentEpisode: {
          startedAt: observation.observedAt,
          lastNotifiedAt: observation.observedAt,
          lastNotifiedMagnitude: observation.magnitude,
          lastNotifiedTransition: isRecurrence ? 'recurrence' : 'new',
          peakSeverityTier: observation.severityTier || null,
        }
      }
    };
  }

  // priorStatus is 'active' or 'recovering'
  if (breaching) {
    const consecutiveBreach = (prior.consecutiveBreach || 0) + 1;
    const peakSeverityTier = observation.severityTier || prior.currentEpisode?.peakSeverityTier || null;
    // criticalBypass (the field consumed by the §6.6 bypass) stays tied specifically
    // to the literal 'critical' tier, unchanged from before -- this is a distinct
    // concept from the general tier-ladder escalation below.
    const crossedIntoCritical = isCriticalSeverity(observation.severityTier)
      && prior.currentEpisode?.peakSeverityTier !== 'critical';

    // Phase 4: generalizes the old "only crossing into critical escalates" check
    // into any upward crossing on the configured tier ladder (default
    // warning -> critical -> paging), so a custom-named tier ladder (or a jump
    // straight to the top tier) also escalates, not just a literal 'critical' name.
    // A workflow with no severity_tiers never sets observation.severityTier, so
    // tierRank is -1 on both sides and this is always false for it -- default
    // behavior for existing workflows is unchanged.
    const tierOrder = policy.severity_tier_order || DEFAULT_TIER_ORDER;
    const priorPeakRank = tierRank(prior.currentEpisode?.peakSeverityTier, tierOrder);
    const nextTierRank = tierRank(observation.severityTier, tierOrder);
    const crossedUpTier = nextTierRank !== -1 && nextTierRank > priorPeakRank;

    const magnitudeChangePct = computeMagnitudeChangePct(
      prior.currentEpisode?.lastNotifiedMagnitude,
      observation.magnitude
    );
    const isSignificant = magnitudeChangePct != null && Math.abs(magnitudeChangePct) >= significanceDeltaPct;
    const escalates = crossedUpTier || isSignificant;

    const nextEpisode = {
      ...prior.currentEpisode,
      peakSeverityTier,
    };
    if (escalates) {
      nextEpisode.lastNotifiedAt = observation.observedAt;
      nextEpisode.lastNotifiedMagnitude = observation.magnitude;
      nextEpisode.lastNotifiedTransition = 'escalation';
    }

    return {
      transition: escalates ? 'escalation' : 'none',
      notify: escalates,
      criticalBypass: crossedIntoCritical,
      nextState: {
        ...prior,
        status: 'active',
        lastSeenAt: observation.observedAt,
        lastObservationKey: observation.observationKey,
        consecutiveBreach,
        consecutiveClean: 0,
        inconclusiveStreak: 0,
        currentEpisode: nextEpisode,
      }
    };
  }

  // Clean reading while active/recovering.
  const consecutiveClean = (prior.consecutiveClean || 0) + 1;
  if (consecutiveClean >= clearAfterObservations) {
    return {
      transition: 'resolved',
      notify: true,
      nextState: {
        ...prior,
        status: 'resolved',
        lastSeenAt: observation.observedAt,
        lastObservationKey: observation.observationKey,
        consecutiveBreach: 0,
        consecutiveClean,
        inconclusiveStreak: 0,
        resolvedAt: observation.observedAt,
      }
    };
  }

  return {
    transition: 'none',
    notify: false,
    nextState: {
      ...prior,
      status: 'recovering',
      lastSeenAt: observation.observedAt,
      lastObservationKey: observation.observationKey,
      consecutiveBreach: 0,
      consecutiveClean,
      inconclusiveStreak: 0,
    }
  };
}

function computeMagnitudeChangePct(lastNotifiedMagnitude, currentMagnitude) {
  if (lastNotifiedMagnitude == null || currentMagnitude == null) return null;
  if (lastNotifiedMagnitude === 0) return currentMagnitude === 0 ? 0 : null;
  return ((currentMagnitude - lastNotifiedMagnitude) / Math.abs(lastNotifiedMagnitude)) * 100;
}

function withinRecurrenceWindow(prior, observation, recurrenceWindowMs) {
  const windowMs = recurrenceWindowMs ?? 7 * 24 * 60 * 60 * 1000;
  if (!prior?.resolvedAt || !observation?.observedAt) return false;
  const resolvedAt = new Date(prior.resolvedAt).getTime();
  const observedAt = new Date(observation.observedAt).getTime();
  return observedAt - resolvedAt <= windowMs;
}

module.exports = {
  computeTransition,
  classifyConclusiveness,
  computeMagnitudeChangePct,
};
