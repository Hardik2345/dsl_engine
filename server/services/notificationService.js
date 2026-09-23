const {
  computeScopeKey,
  computeFingerprint,
  computeFingerprintHash,
  computeStateKey,
} = require('../lib/fingerprint');
const { computeTransition } = require('../lib/alertTransition');
const { evaluateSuppression, rankByEvidenceScore, parseDurationMs, DEFAULT_MIN_INTERVAL_MS } = require('../lib/suppressionPipeline');
const { renderFindingEmail } = require('../lib/emailPresets/findingV1');
const { renderDigestEmail } = require('../lib/emailPresets/digest');
const { getRetryDelayMs } = require('../../scheduler/domain/retryPolicy');

const RUN_STATUS_MAP = {
  completed: 'completed',
  terminated: 'terminated',
  failed: 'failed',
  dead_letter: 'dead_letter',
};

const FLAP_WINDOW_MS = 72 * 60 * 60 * 1000;
const FLAP_MAX_EPISODES = 3;
const BURST_MAX_IMMEDIATE = 5;

function resolveMagnitude(entry, metric) {
  const deltas = entry?.deltas || {};
  return deltas[`${metric}_delta_pct`] ?? deltas.cvr_delta_pct ?? null;
}

function resolveObservationKey({ windowMode, window }) {
  const windowEnd = window?.end || 'unknown';
  return `${windowMode || 'default'}|${windowEnd}`;
}

// The finding email's "Current: X · Baseline: Y" line needs display strings, not
// raw fractions -- picks the field matching whatever metric the breakdown entry was
// actually ranked on (entry.base_metric), mirroring resolveMagnitude's same choice.
function formatCurrentBaseline(entry, metric) {
  const current = entry?.current || {};
  const baseline = entry?.baseline || {};
  if (metric === 'orders') {
    return { current: current.orders ?? null, baseline: baseline.orders ?? null };
  }
  if (metric === 'sessions') {
    return { current: current.sessions ?? null, baseline: baseline.sessions ?? null };
  }
  if (metric === 'atc_rate') {
    return {
      current: current.atc_rate != null ? `${(current.atc_rate * 100).toFixed(2)}%` : null,
      baseline: baseline.atc_rate != null ? `${(baseline.atc_rate * 100).toFixed(2)}%` : null,
    };
  }
  return {
    current: current.cvr != null ? `${(current.cvr * 100).toFixed(2)}%` : null,
    baseline: baseline.cvr != null ? `${(baseline.cvr * 100).toFixed(2)}%` : null,
  };
}

function contentHashOf(subject, html) {
  const crypto = require('crypto');
  return crypto.createHash('sha1').update(`${subject}|${html}`).digest('hex');
}

// Mongo-backed store used in production. Tests inject a plain-object fake with this
// same shape (same DI idiom as emailService.js's ledger adapter / EmailNode's
// runtime.emailSender), so this logic is testable without a real DB.
function createMongoAlertStore() {
  const AlertState = require('../models/AlertState');
  const AlertObservation = require('../models/AlertObservation');
  const NotificationLedger = require('../models/NotificationLedger');
  const NotificationSpool = require('../models/NotificationSpool');
  const AlertShadow = require('../models/AlertShadow');
  const Workflow = require('../models/Workflow');
  const WorkflowVersion = require('../models/WorkflowVersion');
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return {
    async getState(tenantId, stateKey) {
      return AlertState.findOne({ tenantId, stateKey }).lean();
    },
    async listOpenExcluding(tenantId, scopeKey, excludeStateKeys) {
      return AlertState.find({
        tenantId,
        stateKey: { $regex: `^${escapeRegExp(scopeKey)}:`, $nin: excludeStateKeys },
        status: { $in: ['active', 'recovering'] }
      }).lean();
    },
    async saveState(tenantId, stateKey, nextState) {
      await AlertState.updateOne(
        { tenantId, stateKey },
        { $set: { ...nextState, tenantId, stateKey } },
        { upsert: true }
      );
    },
    async recordObservation(observation) {
      await AlertObservation.updateOne(
        { tenantId: observation.tenantId, stateKey: observation.stateKey, observationKey: observation.observationKey },
        { $set: observation },
        { upsert: true }
      );
    },
    async recordLedgerRow(entry) {
      try {
        await NotificationLedger.create(entry);
      } catch (error) {
        if (error && error.code === 11000) return; // another attempt already logged this
        throw error;
      }
    },
    async getAlertShadowCooldownMinutes(tenantId, alertId) {
      if (!alertId) return null;
      const doc = await AlertShadow.findOne({ tenantId, alertId }).lean();
      return doc?.cooldownMinutes ?? null;
    },
    async pushToSpool({ tenantId, digestKey, windowStart, windowEnd, item }) {
      // NotificationSpool has a UNIQUE index on {tenantId, digestKey} -- only one
      // doc can ever exist per digest key, so an upsert scoped to status: 'open'
      // would throw E11000 the moment a doc for this key has already flushed once
      // (matches nothing -> tries to insert a second doc with the same key).
      // Matching on {tenantId, digestKey} alone (no status) instead avoids that,
      // but silently pushes new items into an already-flushed doc that
      // sweepOpenDigests (status: 'open' only) will never look at again -- items
      // land in the collection but are never swept or sent. So: read first, and if
      // the existing doc has already flushed, explicitly reopen it with just this
      // item (never resurrect the old, already-delivered items into a new send).
      const existing = await NotificationSpool.findOne({ tenantId, digestKey }, { status: 1 }).lean();
      if (existing && existing.status !== 'open') {
        await NotificationSpool.updateOne(
          { tenantId, digestKey },
          { $set: { status: 'open', windowStart, windowEnd, mode: 'burst_overflow', items: [item] } }
        );
        return;
      }
      await NotificationSpool.updateOne(
        { tenantId, digestKey },
        {
          $push: { items: item },
          $set: { windowEnd },
          $setOnInsert: { tenantId, digestKey, windowStart, mode: 'burst_overflow', status: 'open' }
        },
        { upsert: true }
      );
    },
    // Gap #1: digest-flush persistence, going through the store like everything
    // else in this file instead of flushDigest/sweepOpenDigests reaching for the
    // model directly.
    async findOpenSpool(tenantId, digestKey) {
      return NotificationSpool.findOne({ tenantId, digestKey, status: 'open' }).lean();
    },
    async markSpoolFlushed(tenantId, digestKey, flushedAt) {
      await NotificationSpool.updateOne({ tenantId, digestKey }, { $set: { status: 'flushed', flushedAt } });
    },
    async findDueSpools(cutoff) {
      return NotificationSpool.find({ status: 'open', windowEnd: { $lte: cutoff } }).lean();
    },
    // Gap #2: pending-delivery sweep persistence.
    async findDuePendingLedgerRows(cutoff) {
      return NotificationLedger.find({
        status: 'pending',
        $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: null }, { nextAttemptAt: { $lte: cutoff } }]
      }).lean();
    },
    async markLedgerDelivered(tenantId, id, status, extra = {}) {
      await NotificationLedger.updateOne({ _id: id, tenantId }, { $set: { status, ...extra } });
    },
    async bumpLedgerAttempt(tenantId, id, nextAttemptAt) {
      await NotificationLedger.updateOne({ _id: id, tenantId }, { $set: { nextAttemptAt }, $inc: { attempt: 1 } });
    },
    // Stale detection: which findings are open, and what stale_after each one's
    // workflow currently declares (null/unset -- feature off for that workflow).
    async findStaleCandidates() {
      return AlertState.find({ status: { $in: ['active', 'recovering'] } }).lean();
    },
    async getStaleAfterMs(tenantId, workflowId) {
      const workflow = await Workflow.findOne({ tenantId, workflowId }).lean();
      if (!workflow) return null;
      const version = await WorkflowVersion.findOne({ tenantId, workflowId, version: workflow.latestVersion }).lean();
      const alertStateNodeDef = (version?.definitionJson?.nodes || []).find((n) => n.type === 'alert_state');
      const staleAfter = alertStateNodeDef?.notify_policy?.stale_after;
      return typeof staleAfter === 'number' && staleAfter > 0 ? staleAfter : null;
    },
    // Digest sweep runs periodically across every tenant/workflow's spools, not
    // per-run, so (unlike enforceObserve's options.recipients, threaded from the
    // triggering run) it has no run context to read a `to` list from -- it has to
    // resolve the workflow's finding-email node itself. Uses the same
    // tenantId/tenantIds-aware resolver as real execution rather than a raw
    // Workflow.findOne, which would silently miss versions saved with tenantIds
    // (array) instead of tenantId (see workflowResolverService's buildWorkflowVersionQuery).
    async getFindingEmailRecipients(tenantId, workflowId) {
      try {
        const { resolveWorkflowVersion } = require('./workflowResolverService');
        const { workflowVersion } = await resolveWorkflowVersion({ tenantId, workflowId });
        const emailNodeDef = (workflowVersion?.definitionJson?.nodes || [])
          .find((n) => n.type === 'email' && n.format === 'finding');
        return emailNodeDef?.to || [];
      } catch (error) {
        return [];
      }
    },
    async deliver({ to, subject, html, text }) {
      const { sendEmail } = require('./emailService');
      return sendEmail({ to, subject, html, text });
    },
  };
}

function createNotificationService({ store = createMongoAlertStore(), now = () => new Date() } = {}) {
  function buildScopeAndKey({ tenantId, workflowId, windowMode, entry, metric, outputKey }) {
    const scopeKey = computeScopeKey({ tenantId, workflowId, stateScope: { mode: 'workflow' }, windowMode });
    const fingerprint = computeFingerprint({ entry, metric, direction: 'drop', outputKey, ruleId: null, scopeKey });
    const fingerprintHash = computeFingerprintHash(fingerprint);
    const stateKey = computeStateKey(scopeKey, fingerprintHash);
    return { scopeKey, fingerprint, fingerprintHash, stateKey };
  }

  // Legacy/Phase-1-2 path: auto-scans every context.breakdowns entry with a
  // hardcoded default fingerprint config. This is the fallback for workflows that
  // don't (yet) declare an alert_state node -- design §9.4's "backward compatible,
  // opt-out not opt-in" decision.
  async function computeObservations({ run, result }) {
    const context = result.context || {};
    const meta = context.meta || {};
    const tenantId = run.tenantId;
    const workflowId = run.workflowId;
    const runStatus = RUN_STATUS_MAP[result.status] || result.status;
    const observedAt = now();
    const windowMode = meta.windowMode || meta.window?.mode || 'default';
    const scopeKey = computeScopeKey({ tenantId, workflowId, stateScope: { mode: 'workflow' }, windowMode });
    const observationKey = resolveObservationKey({ windowMode, window: meta.window });
    const triggerType = run.triggerType === 'cron' ? 'cron' : 'event';

    const breakdowns = context.breakdowns || {};
    const observations = [];
    const touchedStateKeys = new Set();

    for (const [outputKey, entries] of Object.entries(breakdowns)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const metric = entry.base_metric || 'cvr';
        const { fingerprint, fingerprintHash, stateKey } = buildScopeAndKey({ tenantId, workflowId, windowMode, entry, metric, outputKey });
        touchedStateKeys.add(stateKey);
        const prior = await store.getState(tenantId, stateKey);
        const { transition, notify, criticalBypass, nextState } = computeTransition(prior, {
          runStatus, breaching: true, magnitude: resolveMagnitude(entry, metric),
          severityTier: null, triggerType, observationKey, observedAt, policy: {},
        });
        observations.push({
          tenantId, workflowId, runId: String(run._id), stateKey,
          fingerprint: { ...fingerprint, hash: fingerprintHash },
          entry, transition, notify, criticalBypass, nextState, observationKey, observedAt,
        });
      }
    }

    const stillOpen = await store.listOpenExcluding(tenantId, scopeKey, Array.from(touchedStateKeys));
    for (const priorDoc of stillOpen) {
      const { transition, notify, criticalBypass, nextState } = computeTransition(priorDoc, {
        runStatus, breaching: false, magnitude: null,
        severityTier: null, triggerType, observationKey, observedAt, policy: {},
      });
      observations.push({
        tenantId, workflowId, runId: String(run._id), stateKey: priorDoc.stateKey,
        fingerprint: priorDoc.fingerprint,
        entry: null, transition, notify, criticalBypass, nextState, observationKey, observedAt,
      });
    }

    return observations;
  }

  // Phase 3 path: an alert_state node already computed fingerprints/transitions
  // during execution (nodes/AlertStateNode.js) and declared them into
  // context.alertStates.transitions. The notifier's job here is purely to gate and
  // deliver -- recomputing transitions from raw breakdowns here as well would create
  // a second, independent, potentially-disagreeing computation of the same thing.
  function buildDeclaredObservations({ run, result }) {
    const context = result.context || {};
    const meta = context.meta || {};
    const observationKey = resolveObservationKey({
      windowMode: meta.windowMode || meta.window?.mode || 'default', window: meta.window
    });
    const observedAt = now();
    const transitions = context.alertStates?.transitions || [];

    return transitions.map((t) => ({
      tenantId: run.tenantId,
      workflowId: run.workflowId,
      runId: String(run._id),
      stateKey: t.stateKey,
      fingerprint: t.finding?.fingerprint,
      entry: t.finding?.entry || null,
      transition: t.transition,
      notify: t.notify,
      criticalBypass: t.criticalBypass,
      nextState: t.snapshot,
      observationKey,
      observedAt,
    }));
  }

  async function persistObservation(observation) {
    await store.saveState(observation.tenantId, observation.stateKey, {
      workflowId: observation.workflowId,
      fingerprint: observation.fingerprint,
      lastObservationRunId: observation.runId,
      ...observation.nextState,
    });
    await store.recordObservation({
      tenantId: observation.tenantId,
      stateKey: observation.stateKey,
      runId: observation.runId,
      observationKey: observation.observationKey,
      observedAt: observation.observedAt,
      breaching: Boolean(observation.entry),
      conclusive: observation.transition !== 'inconclusive',
      transition: observation.transition,
      notified: observation.notify,
    });
  }

  // Phase 1: computes fingerprints/transitions and logs full ledger rows including
  // what *would* be suppressed, but gates nothing -- every real send from Phase 0
  // still happens independently of this. See docs/state-based-alerting-design.md §14
  // Phase 1 and §5.5 (why fingerprints ship in shadow mode first).
  async function shadowObserve({ run, result }) {
    const observations = await computeObservations({ run, result });
    for (const observation of observations) {
      await persistObservation(observation);
      await store.recordLedgerRow({
        tenantId: observation.tenantId,
        // runId included so a manual re-run against the same fixed window (common
        // during testing) always gets its own audit row -- previously the same
        // stateKey+observationKey pair collided with the unique index on every
        // repeat run, silently dropping the row and leaving the ledger/UI blank
        // even though the pipeline had genuinely re-evaluated everything correctly.
        dedupeKey: `shadow|${observation.stateKey}|${observation.observationKey}|${observation.runId}`,
        stateKey: observation.stateKey,
        workflowId: observation.workflowId,
        runId: observation.runId,
        transition: observation.transition,
        observationKey: observation.observationKey,
        channel: 'email',
        status: 'suppressed',
        suppressedReason: observation.notify ? 'shadow_would_notify' : (observation.transition === 'inconclusive' ? 'inconclusive' : 'no_transition'),
      });
    }
  }

  // Shared Phase 2 delivery pipeline (design §7, §6.6). Consumes a list of already-
  // classified observations -- either auto-scanned (legacy workflows) or declared by
  // an alert_state node (Phase 3 workflows) -- and gates/sends/digests each one.
  async function runDeliveryPipeline(observations, run, options = {}) {
    const notifyCandidates = observations.filter((o) => o.notify);
    const ranked = rankByEvidenceScore(notifyCandidates.map((o) => ({ entry: o.entry || {}, observation: o })))
      .map((item) => item.observation);
    const rankIndex = new Map(ranked.map((o, index) => [o.stateKey, index]));

    // notify_policy.min_interval is the design-doc/validator/UI field (a duration
    // string like "24h"); this used to silently do nothing because the code read a
    // "min_interval_ms" field that was never actually settable (not in the
    // validator's allowlist) or set by anything -- cooldown was always the 24h
    // default regardless of what an author configured. Fixed to parse the real field.
    const minIntervalMs = parseDurationMs(options.notifyPolicy?.min_interval, DEFAULT_MIN_INTERVAL_MS);
    const burstCap = options.notifyPolicy?.burst_cap?.max_immediate ?? BURST_MAX_IMMEDIATE;
    const cooldownMinutesFromShadow = await store.getAlertShadowCooldownMinutes(run.tenantId, options.alertId);
    const effectiveCooldownMs = cooldownMinutesFromShadow
      ? Math.max(minIntervalMs, cooldownMinutesFromShadow * 60 * 1000)
      : minIntervalMs;

    const decisions = [];

    for (const observation of observations) {
      const prior = await store.getState(observation.tenantId, observation.stateKey);
      await persistObservation(observation);

      if (!observation.notify) {
        await store.recordLedgerRow({
          tenantId: observation.tenantId,
          dedupeKey: `enforce|${observation.stateKey}|${observation.observationKey}|${observation.runId}`,
          stateKey: observation.stateKey,
          workflowId: observation.workflowId,
          runId: observation.runId,
          transition: observation.transition,
          observationKey: observation.observationKey,
          channel: 'email',
          status: 'suppressed',
          suppressedReason: observation.transition === 'inconclusive' ? 'inconclusive' : 'no_transition',
        });
        continue;
      }

      // notify_policy.critical_bypass.enabled: false lets an author opt a workflow
      // out of the §6.6 bypass entirely, for cases where even a critical finding
      // should still sit behind cooldown/quiet-hours/flap demotion.
      const criticalBypassEnabled = options.notifyPolicy?.critical_bypass?.enabled !== false;
      const effectiveCriticalBypass = observation.criticalBypass && criticalBypassEnabled;

      // 'resolved' and 'recurrence' must never sit behind cooldown. Both represent
      // the END of the episode the cooldown timestamp belongs to -- resolved closes
      // it, recurrence opens a wholly new one after the old one closed (design
      // §5.3's "reset conceptually") -- yet `prior` here is always the PRE-
      // transition snapshot, so prior.currentEpisode.lastNotifiedAt is still the
      // OLD episode's timestamp in both cases. Gating either against it means the
      // cooldown meant to rate-limit "still broken" reminders within one ongoing
      // episode ends up silently eating "it's fixed" and "it's back" instead --
      // confirmed live for both: a finding notified once, then resolved 12 minutes
      // later, then recurring 19 minutes after that (all inside a 30m min_interval)
      // had its resolved AND recurrence ledger rows both land as suppressed/cooldown.
      const isEpisodeBoundary = observation.transition === 'resolved' || observation.transition === 'recurrence';
      const lastNotifiedAt = prior?.currentEpisode?.lastNotifiedAt;
      const cooldownOk = effectiveCriticalBypass || isEpisodeBoundary || !lastNotifiedAt
        || (observation.observedAt - new Date(lastNotifiedAt).getTime()) >= effectiveCooldownMs;

      // Read from nextState (this observation's freshly-computed transition output),
      // not prior -- flapCount/flapWindowStartedAt are now written by
      // alertTransition.js's computeTransition itself, so nextState is the only
      // place they're guaranteed populated. Reading from `prior` here was the
      // original bug: prior.flapWindowStartedAt was never written anywhere, so
      // flapWindowActive was always false in production.
      const flapMaxEpisodes = options.notifyPolicy?.flap?.max_episodes ?? FLAP_MAX_EPISODES;
      const flapWindowMs = options.notifyPolicy?.flap?.window_ms ?? FLAP_WINDOW_MS;
      const flapWindowActive = observation.nextState?.flapWindowStartedAt
        && (observation.observedAt - new Date(observation.nextState.flapWindowStartedAt).getTime()) <= flapWindowMs;
      const flapDemoted = flapWindowActive && (observation.nextState?.flapCount || 0) > flapMaxEpisodes;

      const label = observation.entry?.display_value || observation.entry?.value || observation.fingerprint?.value || observation.stateKey;
      const displayMetric = observation.entry?.base_metric || 'cvr';
      const { current: currentDisplay, baseline: baselineDisplay } = formatCurrentBaseline(observation.entry, displayMetric);
      const finding = {
        tenantId: observation.tenantId,
        label,
        entry: observation.entry,
        transition: observation.transition,
        firstSeenAt: observation.nextState?.firstSeenAt,
        daysOpen: observation.nextState?.firstSeenAt
          ? Math.max(1, Math.round((observation.observedAt - new Date(observation.nextState.firstSeenAt).getTime()) / (24 * 60 * 60 * 1000)) + 1)
          : 1,
        episodeCount: observation.nextState?.episodeCount,
        severityTier: observation.nextState?.currentEpisode?.peakSeverityTier,
        trend: [],
        current: currentDisplay,
        baseline: baselineDisplay,
        deltaPct: observation.entry?.deltas?.cvr_delta_pct,
        stateKey: observation.stateKey,
      };
      const rendered = renderFindingEmail({ finding, branding: options.branding, brandNameOverride: options.brandName });
      const contentHash = contentHashOf(rendered.subject, rendered.html);

      const decision = evaluateSuppression({
        transition: observation.transition,
        conclusive: true,
        dryRun: Boolean(options.dryRun),
        criticalBypass: effectiveCriticalBypass,
        humanState: {
          muted: Boolean(prior?.mutedAt),
          snoozed: prior?.snoozedUntil ? { until: prior.snoozedUntil } : null,
          acked: Boolean(prior?.ackedAt),
        },
        flapDemoted,
        cooldownOk,
        isSignificant: true,
        quietHours: options.notifyPolicy?.quiet_hours,
        timezone: run.context?.meta?.timezone || 'UTC',
        now: new Date(observation.observedAt),
        burstCap,
        burstRank: rankIndex.get(observation.stateKey),
        contentHash,
        priorContentHash: null,
      });

      const dedupeKey = `enforce|${observation.stateKey}|${observation.transition}|${observation.observationKey}|${observation.runId}`;

      if (decision.action === 'send') {
        // Gap #2 (design §11.4): write a pending row and stop -- actual SMTP
        // delivery, the ledger's sent/failed update, and the lastNotifiedAt bump
        // all happen later in sweepPendingDeliveries, off the request/run path.
        // "Notified" should mean delivered, not merely decided-to-send.
        await store.recordLedgerRow({
          tenantId: observation.tenantId, dedupeKey, stateKey: observation.stateKey, workflowId: observation.workflowId,
          runId: observation.runId, transition: observation.transition, observationKey: observation.observationKey,
          channel: 'email', recipients: options.recipients || [], subject: rendered.subject, contentHash,
          renderedHtml: rendered.html, renderedText: rendered.text,
          pendingStateSnapshot: { currentEpisode: { ...observation.nextState.currentEpisode, lastNotifiedMagnitude: finding.deltaPct } },
          status: 'pending', nextAttemptAt: observation.observedAt,
        });
      } else if (decision.action === 'digest') {
        await store.pushToSpool({
          tenantId: observation.tenantId,
          digestKey: `${observation.workflowId}|digest`,
          windowStart: observation.observedAt,
          windowEnd: observation.observedAt,
          item: { stateKey: observation.stateKey, transition: observation.transition, snapshot: { label, deltaPct: finding.deltaPct } },
        });
        await store.recordLedgerRow({
          tenantId: observation.tenantId, dedupeKey, stateKey: observation.stateKey, workflowId: observation.workflowId,
          runId: observation.runId, transition: observation.transition, observationKey: observation.observationKey,
          channel: 'email', status: 'suppressed', suppressedReason: decision.reason,
        });
      } else if (decision.action === 'hold') {
        await store.recordLedgerRow({
          tenantId: observation.tenantId, dedupeKey, stateKey: observation.stateKey, workflowId: observation.workflowId,
          runId: observation.runId, transition: observation.transition, observationKey: observation.observationKey,
          channel: 'email', status: 'held', suppressedReason: decision.reason, heldUntil: decision.heldUntil,
        });
      } else {
        await store.recordLedgerRow({
          tenantId: observation.tenantId, dedupeKey, stateKey: observation.stateKey, workflowId: observation.workflowId,
          runId: observation.runId, transition: observation.transition, observationKey: observation.observationKey,
          channel: 'email', status: 'suppressed', suppressedReason: decision.reason,
        });
      }

      decisions.push({ stateKey: observation.stateKey, transition: observation.transition, decision });
    }

    return decisions;
  }

  // Phase 2/3 entry point: transitions actually gate delivery. Uses declared
  // alert_state transitions when present (Phase 3 DSL surface), otherwise falls back
  // to the legacy auto-scan (Phase 1/2 default, design §9.4 backward compatibility).
  async function enforceObserve({ run, result, options = {} }) {
    const declared = result.context?.alertStates?.transitions;
    const observations = Array.isArray(declared) && declared.length
      ? buildDeclaredObservations({ run, result })
      : await computeObservations({ run, result });
    return runDeliveryPipeline(observations, run, options);
  }

  async function flushDigest({ tenantId, digestKey, options = {} }) {
    const spool = await store.findOpenSpool(tenantId, digestKey);
    if (!spool || !spool.items.length) return null;

    // digestKey is `${workflowId}|digest` -- recipients weren't threaded from
    // anywhere before (options.recipients was always undefined from the sweep),
    // so every digest send silently failed with "at least one recipient is
    // required" and was still marked flushed below regardless, discarding it.
    const workflowId = digestKey.split('|')[0];
    const recipients = options.recipients?.length
      ? options.recipients
      : await store.getFindingEmailRecipients(tenantId, workflowId);

    const rendered = renderDigestEmail({ items: spool.items, branding: options.branding, brandNameOverride: options.brandName });
    const delivery = await store.deliver({ to: recipients, subject: rendered.subject, html: rendered.html, text: rendered.text });

    // Only mark flushed on a confirmed send -- otherwise the spool stays 'open'
    // and findDueSpools naturally retries it on the next sweep tick, instead of
    // silently discarding a failed digest with no error surfaced anywhere.
    if (delivery?.status === 'sent') {
      await store.markSpoolFlushed(tenantId, digestKey, now());
    } else {
      console.error('[notify] digest delivery failed', { tenantId, digestKey, error: delivery?.error });
    }
    return delivery;
  }

  const DIGEST_MIN_AGE_MS = 5 * 60 * 1000;

  // Flushes any open digest spool old enough to send -- the design's §8.4 "loop hung
  // off the existing worker tick." Exception-isolated per spool so one bad digest
  // never blocks the sweep from reaching the rest.
  async function sweepOpenDigests({ olderThanMs = DIGEST_MIN_AGE_MS, options = {} } = {}) {
    const cutoff = new Date(now().getTime() - olderThanMs);
    const due = await store.findDueSpools(cutoff);

    let flushed = 0;
    for (const spool of due) {
      try {
        const result = await flushDigest({ tenantId: spool.tenantId, digestKey: spool.digestKey, options });
        if (result) flushed += 1;
      } catch (error) {
        console.error('[notify] digest flush failed', { tenantId: spool.tenantId, digestKey: spool.digestKey, error: error.message });
      }
    }
    return { count: flushed };
  }

  // Gap #2 (design §11.4): sweeps 'pending' ledger rows (written synchronously by
  // runDeliveryPipeline's send branch instead of calling store.deliver inline) and
  // performs the actual send here, off the request/run path. Only bumps
  // currentEpisode.lastNotifiedAt on a confirmed send -- "notified" should mean
  // delivered, not merely decided-to-send.
  async function sweepPendingDeliveries({ options = {} } = {}) {
    const cutoff = now();
    const due = await store.findDuePendingLedgerRows(cutoff);

    let sent = 0;
    for (const row of due) {
      try {
        const delivery = await store.deliver({
          to: row.recipients || [], subject: row.subject, html: row.renderedHtml, text: row.renderedText,
        });

        if (delivery?.status === 'sent') {
          await store.markLedgerDelivered(row.tenantId, row._id, 'sent', { sentAt: now(), messageId: delivery.messageId, provider: delivery.provider });
          if (row.pendingStateSnapshot) {
            await store.saveState(row.tenantId, row.stateKey, {
              currentEpisode: {
                ...row.pendingStateSnapshot.currentEpisode,
                lastNotifiedAt: now(),
                lastNotifiedMagnitude: row.pendingStateSnapshot.currentEpisode?.lastNotifiedMagnitude,
              },
            });
          }
          sent += 1;
          continue;
        }

        const delayMs = getRetryDelayMs({ maxAttempts: 5, backoffSeconds: [30, 120, 600, 1800] }, (row.attempt || 0) + 1);
        if (delayMs == null) {
          await store.markLedgerDelivered(row.tenantId, row._id, 'failed', { lastError: delivery?.error || 'delivery failed' });
        } else {
          await store.bumpLedgerAttempt(row.tenantId, row._id, new Date(now().getTime() + delayMs));
        }
      } catch (error) {
        console.error('[notify] pending delivery failed', { tenantId: row.tenantId, ledgerId: row._id, error: error.message });
      }
    }
    return { count: sent };
  }

  const DEFAULT_STALE_SWEEP_MIN_LAST_SEEN_MS = 0;

  // Stale detection (design §6.1/§6.3, "any -> stale, surfaced in the UI
  // regardless"). Off by default per-workflow (notify_policy.stale_after unset =
  // skipped) and NEVER sends mail on this transition -- staleness is a silent
  // state change, not a new notification a tenant didn't ask for.
  async function sweepStaleFindings({ options = {} } = {}) {
    const candidates = await store.findStaleCandidates();
    let staled = 0;

    for (const state of candidates) {
      try {
        const staleAfterMs = await store.getStaleAfterMs(state.tenantId, state.workflowId);
        if (!staleAfterMs) continue;
        const lastSeenAt = state.lastSeenAt ? new Date(state.lastSeenAt).getTime() : 0;
        if (now().getTime() - lastSeenAt < staleAfterMs + DEFAULT_STALE_SWEEP_MIN_LAST_SEEN_MS) continue;

        await store.saveState(state.tenantId, state.stateKey, { status: 'stale' });
        await store.recordLedgerRow({
          tenantId: state.tenantId,
          dedupeKey: `stale|${state.stateKey}|${state.lastObservationKey || 'unknown'}`,
          stateKey: state.stateKey, workflowId: state.workflowId, transition: 'stale',
          observationKey: state.lastObservationKey, channel: 'email',
          status: 'suppressed', suppressedReason: 'stale_no_notify',
        });
        staled += 1;
      } catch (error) {
        console.error('[notify] stale sweep failed', { tenantId: state.tenantId, stateKey: state.stateKey, error: error.message });
      }
    }
    return { count: staled };
  }

  return {
    shadowObserve, enforceObserve, flushDigest, sweepOpenDigests, sweepPendingDeliveries, sweepStaleFindings,
    computeObservations, buildDeclaredObservations,
  };
}

const defaultNotificationService = createNotificationService();

module.exports = {
  createNotificationService,
  createMongoAlertStore,
  shadowObserve: defaultNotificationService.shadowObserve,
  enforceObserve: defaultNotificationService.enforceObserve,
  sweepOpenDigests: defaultNotificationService.sweepOpenDigests,
  sweepPendingDeliveries: defaultNotificationService.sweepPendingDeliveries,
  sweepStaleFindings: defaultNotificationService.sweepStaleFindings,
  flushDigest: defaultNotificationService.flushDigest,
};
