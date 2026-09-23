const { resolveEntryMetric, evaluate } = require('./BranchNode');
const {
  computeScopeKey,
  computeFingerprint,
  computeFingerprintHash,
  computeStateKey,
} = require('../server/lib/fingerprint');
const { computeTransition } = require('../server/lib/alertTransition');
const { parseDurationMs } = require('../server/lib/suppressionPipeline');

function evaluateConditionGroup(conditions, entry) {
  if (!Array.isArray(conditions) || !conditions.length) return false;
  return conditions.every((condition) => {
    const value = resolveEntryMetric(entry, condition.metric);
    return value !== undefined && evaluate(value, condition.op, condition.value);
  });
}

function resolveSeverityTier(severityTiers, entry) {
  if (!Array.isArray(severityTiers)) return null;
  for (const tier of severityTiers) {
    if (evaluateConditionGroup(tier.when, entry)) return tier.name;
  }
  return null;
}

function resolveObservationKey({ windowMode, window }) {
  const windowEnd = window?.end || 'unknown';
  return `${windowMode || 'default'}|${windowEnd}`;
}

// runtime.rootWorkflowIdentity comes in as "<tenantScope>/<workflowId>@<version>"
// (see WorkflowRunner's rootIdentity / workflowExecutionService's workflowIdentity
// option). Using that whole string as the scope's workflowId component embeds the
// exact version into every fingerprint's stateKey -- meaning saving any edit to the
// workflow (bumping its version) silently orphans every currently-open finding,
// discarding its episode/days-open/ack history and rediscovering it as brand new.
// Scope should survive a routine edit, so this strips both the version suffix and
// the tenant prefix (computeScopeKey re-adds the tenant separately; leaving the
// prefix in would double it), leaving just the bare, version-independent workflowId.
function stripVersionFromIdentity(identity) {
  if (!identity) return identity;
  const withoutVersion = identity.replace(/@[^@/]*$/, '');
  const slashIndex = withoutVersion.indexOf('/');
  return slashIndex === -1 ? withoutVersion : withoutVersion.slice(slashIndex + 1);
}

// Design doc §9.1/§9.3/§10.1/§11.1. This node only computes: it reads prior state
// via runtime.alertStateReader and returns delta.alertStates/delta.notifications --
// it must never write state itself (server/services/notificationService.js owns
// writes and delivery, per §4's "nodes declare, notifier writes" split). Writing
// state here as well as in the post-run notifier would race the two writers.
async function AlertStateNode(def, context, runtime = {}) {
  const {
    sources = [],
    state_scope: stateScope = {},
    breach = {},
    severity_tiers: severityTiers = [],
    notify_policy: notifyPolicy = {},
    then: thenNext,
    then_no_changes: thenNoChanges,
  } = def;

  // Threaded into computeTransition's policy argument below. This used to be
  // missing entirely -- flap/severity_tier_order/recurrence_window overrides
  // configured on the node had no effect on real runs, only in unit tests that
  // called computeTransition directly with a hand-built policy object.
  const transitionPolicy = {
    for_observations: breach.for_observations,
    clear_after_observations: breach.clear_after_observations,
    significance: notifyPolicy.significance,
    flap: notifyPolicy.flap,
    severity_tier_order: notifyPolicy.severity_tier_order,
    recurrence_window_ms: notifyPolicy.recurrence_window !== undefined
      ? parseDurationMs(notifyPolicy.recurrence_window)
      : undefined,
  };

  if (!Array.isArray(sources) || !sources.length) {
    return { status: 'fail', reason: 'AlertStateNode: sources must be a non-empty array' };
  }

  const alertStateReader = runtime.alertStateReader;
  if (!alertStateReader || typeof alertStateReader.getState !== 'function') {
    return { status: 'fail', reason: 'AlertStateNode: alertStateReader runtime is not configured' };
  }

  const meta = context.meta || {};
  const tenantId = meta.tenantId;
  const workflowId = meta.workflowId;
  // §11.1: default per-workflow scope must key on the ROOT workflow identity, not
  // the current (possibly nested, via workflow_ref) frame identity, or refactoring
  // a monolithic workflow into workflow_ref children silently resets every open
  // finding. runtime.rootWorkflowIdentity is threaded by WorkflowRunner for this.
  const scopeWorkflowId = stateScope.mode === 'workflow' || !stateScope.mode
    ? stripVersionFromIdentity(runtime.rootWorkflowIdentity) || workflowId
    : workflowId;

  const windowMode = meta.windowMode || meta.window?.mode || 'default';
  const scopeKey = computeScopeKey({ tenantId, workflowId: scopeWorkflowId, stateScope, windowMode });
  const observationKey = resolveObservationKey({ windowMode, window: meta.window });
  const runStatus = context.__runStatusForAlertState || 'completed';
  const triggerType = meta.triggerType === 'cron' ? 'cron' : 'event';
  const observedAt = new Date().toISOString();

  const breakdowns = context.breakdowns || {};
  const transitions = [];
  const touchedStateKeys = [];

  for (const source of sources) {
    const entries = Array.isArray(breakdowns[source.output_key]) ? breakdowns[source.output_key] : [];
    const limited = source.limit ? entries.slice(0, source.limit) : entries;

    for (const entry of limited) {
      const metric = source.metric || entry.base_metric || 'cvr';
      const fingerprint = computeFingerprint({
        entry, metric, direction: source.direction || 'drop', outputKey: source.output_key, ruleId: null, scopeKey
      });
      const fingerprintHash = computeFingerprintHash(fingerprint);
      const stateKey = computeStateKey(scopeKey, fingerprintHash);
      touchedStateKeys.push(stateKey);

      const prior = await alertStateReader.getState(tenantId, stateKey);
      const breaching = evaluateConditionGroup(breach.enter, entry) && !evaluateConditionGroup(breach.exit, entry);
      const severityTier = resolveSeverityTier(severityTiers, entry);
      const magnitude = resolveEntryMetric(entry, `${metric}_delta_pct`) ?? resolveEntryMetric(entry, 'cvr_delta_pct');

      const { transition, notify, criticalBypass, nextState } = computeTransition(prior, {
        runStatus, breaching, magnitude, severityTier, triggerType, observationKey, observedAt,
        policy: transitionPolicy,
      });

      transitions.push({
        stateKey, transition, notify, criticalBypass,
        finding: { entry, fingerprint, severityTier },
        snapshot: nextState,
      });
    }
  }

  // Findings previously open for this scope but absent from this run's sources get
  // a clean observation, same reasoning as the Phase 1/2 shadow/enforce path: without
  // this, a resolved problem would stay "active" forever once it stops appearing.
  const stillOpen = typeof alertStateReader.listOpenExcluding === 'function'
    ? await alertStateReader.listOpenExcluding(tenantId, scopeKey, touchedStateKeys)
    : [];
  for (const priorDoc of stillOpen) {
    const { transition, notify, criticalBypass, nextState } = computeTransition(priorDoc, {
      runStatus, breaching: false, magnitude: null, severityTier: null, triggerType, observationKey, observedAt,
      policy: transitionPolicy,
    });
    transitions.push({
      stateKey: priorDoc.stateKey, transition, notify, criticalBypass,
      finding: { entry: null, fingerprint: priorDoc.fingerprint, severityTier: null },
      snapshot: nextState,
    });
  }

  const hasChanges = transitions.some((t) => t.transition !== 'none' && t.transition !== 'inconclusive');

  // This node only publishes transitions into context.alertStates -- it does NOT
  // also declare context.notifications itself. Declaration is the downstream
  // `email` node's job via `for_each: "alertStates.transitions"` (design §9.3). If
  // this node declared intents too, a workflow wiring both `emit_to` and a for_each
  // email node would double-declare the same finding.
  return {
    status: 'pass',
    delta: {
      alertStates: { transitions, new: transitions.filter(t => t.transition === 'new').map(t => t.stateKey),
        escalated: transitions.filter(t => t.transition === 'escalation').map(t => t.stateKey),
        resolved: transitions.filter(t => t.transition === 'resolved').map(t => t.stateKey),
        ongoing: transitions.filter(t => t.transition === 'none').map(t => t.stateKey),
        suppressed: transitions.filter(t => !t.notify).map(t => t.stateKey) },
    },
    next: hasChanges ? thenNext : (thenNoChanges ?? thenNext),
  };
}

module.exports = AlertStateNode;
