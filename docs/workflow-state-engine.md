# Workflow State Engine

Status: implemented. This replaces the per-finding design in
`docs/state-based-alerting-design.md`, which was never built on this line.

The state engine decides whether an RCA workflow run sends an email. The workflow
still does all the analysis. The engine turns one number from the run into a state
(NORMAL, TRIGGERED or CRITICAL), always records that state, and then decides
separately whether this run is worth notifying about.

```text
workflow run -> finding value -> state transition -> notification decision -> email / no email
```

Cooldowns and quiet hours only ever block the **email**. They never block a
**state change**.

## 1. Which workflows use it

Every workflow definition has a `workflow_purpose`, set in the visual builder under
**Workflow type**:

| `workflow_purpose` | Behaviour |
|---|---|
| `daily_insight` | Daily insight or report. No state, cooldowns or quiet hours. Emails go out inline on every run, as they always have. It may not enable `state_config` (validation rejects it). |
| `rca` (default when missing) | Uses the state engine **only if** `state_config.enabled` is `true`. Otherwise it behaves as before, sending inline on every run. |

When the engine is on, the workflow's `email` and `insight` nodes still render their
emails, but the sends are captured instead of delivered
(`server/lib/notificationCapture.js`). After the run, the engine sends at most
**one** email: the captured content with a state banner and subject prefix. If no
email node ran, which is typical for a recovery, it sends a built-in state email.

## 2. Configuration

```json
"workflow_purpose": "rca",
"state_config": {
  "enabled": true,
  "finding":     { "metric": "cvr_delta_pct", "direction": "drop" },
  "thresholds":  { "normal": 15, "critical": 25 },
  "cooldown":    { "triggered_minutes": 60, "critical_minutes": 30 },
  "recovery":    { "required_evidence": 2 },
  "quiet_hours": { "enabled": true, "start": "23:00", "end": "07:00" }
}
```

### Finding value

`finding.metric` is a key in the run's final `context.metrics`, normally a signed
percent from `metric_compare` such as `cvr_delta_pct`. The thresholds are
magnitudes, so the raw value is normalized first:

| direction | value | example |
|---|---|---|
| `drop` | `-raw` | raw −17 → **17**; raw +5 → −5 (NORMAL) |
| `rise` | `raw` | raw +17 → 17 |
| `absolute` | `\|raw\|` | raw ±17 → 17 |

Thresholds are inclusive:

- `value < normal` → NORMAL
- `normal ≤ value < critical` → TRIGGERED
- `value ≥ critical` → CRITICAL

With 15 and 25, a value of 15 is TRIGGERED and 25 is CRITICAL.

A run that throws, or finishes without a finite value for the metric, is
**inconclusive**. It is recorded, but it doesn't change state or add recovery
evidence. A `terminated` run that did produce the metric is evaluated normally.

### Quiet hours

Quiet hours use the run's timezone (`context.meta.timezone`, or UTC) at minute
resolution, and both ends are inclusive: with 23:00–07:00, 07:00 is quiet and 07:01
is not. A window may wrap midnight.

## 3. Transitions and notifications

The state is keyed by **(tenantId, workflowId)**. Global and multi-tenant workflows
keep separate state per tenant, and editing a workflow (a new version) keeps its
state.

| previous → result | notification | cooldown | quiet hours |
|---|---|---|---|
| NORMAL → NORMAL | RECOVERY only when recovery evidence is complete (§4), otherwise none | – | applies |
| TRIGGERED/CRITICAL → NORMAL | none: first recovery evidence only | – | – |
| NORMAL → TRIGGERED | INITIAL_TRIGGER | TRIGGERED | applies |
| NORMAL → CRITICAL | ESCALATION | **bypassed** | **bypassed** |
| TRIGGERED → CRITICAL | ESCALATION | **bypassed** | applies |
| TRIGGERED → TRIGGERED | REMINDER | TRIGGERED | applies |
| CRITICAL → CRITICAL | REMINDER | CRITICAL | applies |
| CRITICAL → TRIGGERED | DE_ESCALATION (not a recovery) | TRIGGERED | applies |

Subject prefixes: `[TRIGGERED]`, `[CRITICAL]`, `[REMINDER · <state>]`,
`[IMPROVED]`, `[RECOVERED]`.

### Cooldown

- It is timestamp-based: `{ state, duration_minutes, started_at }`. It is
  (re)started whenever a non-recovery email is sent, with the duration for the
  resulting state.
- A candidate email is blocked while the active time since `started_at` is less than
  the duration for **that candidate's** cooldown state (the "cooldown" column above).
- **The clock pauses during quiet hours.** A 60-minute cooldown started at 22:50 has
  used 10 minutes by 23:00, resumes at 07:01, and expires at 07:51.
- A sent RECOVERY clears the cooldown, so the next incident always opens with
  INITIAL_TRIGGER.
- A suppressed email leaves the cooldown untouched. Nothing is queued. The next real
  run evaluates from scratch (no retroactive sends).

## 4. Recovery evidence

Recovery is deliberately slower than triggering. It needs `required_evidence`
(default and minimum 2) **consecutive NORMAL results from automatic runs**. A run is
automatic when its `triggerType` is `cron` or `event`.

- **TRIGGERED/CRITICAL → NORMAL** starts recovery: `pending = true`,
  `evidence_count = 1` (0 for a manual run). This never sends.
- **NORMAL → NORMAL while pending**: evidence +1 for an automatic run and +0 for a
  manual one. When the count reaches `required_evidence` on an automatic run,
  RECOVERY is sent.
- **Any non-NORMAL result** (automatic or manual) cancels recovery:
  `pending = false`, `evidence_count = 0`.
- **NORMAL → NORMAL without a pending recovery never sends.**
- **Manual runs still change state** and follow the normal rules for every other
  notification. They just add no evidence and never send RECOVERY.
- A RECOVERY that lands in quiet hours stays pending. The next automatic NORMAL run
  outside quiet hours sends it.
- The recovery email's wording depends on what it recovered from (CRITICAL or
  TRIGGERED).

## 5. Persistence, concurrency and idempotency

| Collection | Contents |
|---|---|
| `workflow_states` (`server/models/WorkflowState.js`) | One doc per (tenant, workflow): state, cooldown, recovery, `last_alert_at`, `last_execution_id`, `last_decision`, `version`. |
| `workflow_state_evaluations` (`server/models/WorkflowStateEvaluation.js`) | One audit row per execution: previous/resulting state, finding, decision, and delivery status. 90-day TTL. |
| `WorkflowRun.stateEvaluation` | A summary for the run page. Runs are pruned to 4 per workflow and expire after 7 days, so they are not the audit trail. |

- **Concurrency:** every state write is a compare-and-set on `version`. If another
  execution got there first, the engine re-reads and recomputes from its result, up
  to 5 times, rather than overwriting it. The first write for a workflow relies on
  the unique index.
- **Idempotency:** the execution id is the run id. A retried run re-executes the
  workflow, but the engine replays the decision already recorded for that run (from
  the audit row, or from `last_decision` if the audit write never landed). It never
  transitions twice.
- **Delivery is at-most-once:** the audit row is claimed (`pending → sending`)
  before SMTP. A retry that finds it still `sending` marks it `uncertain` and does
  not resend.
- **SMTP failure:** the state change stands, but the notification bookkeeping this
  run wrote is rolled back. For most reasons the previous cooldown and
  `last_alert_at` are restored. For RECOVERY, the recovery is restored to pending
  with full evidence. A failed send therefore doesn't use up the cooldown, and the
  next eligible run tries again. The rollback is skipped if a later run has alerted
  since.
- A state-engine error never fails or re-queues the run. It is recorded in
  `WorkflowRun.stateEvaluationError`.

## 6. Code map

| File | Role |
|---|---|
| `server/lib/stateEngine/defaults.js` | Constants, defaults, `workflow_purpose` and trigger helpers |
| `server/lib/stateEngine/severity.js` | Finding normalization and threshold classification |
| `server/lib/stateEngine/quietHours.js` | Quiet-minute check and the quiet-paused cooldown clock |
| `server/lib/stateEngine/evaluateState.js` | Pure transition and notification decision |
| `server/services/stateEngineService.js` | Versioned writes, audit rows, delivery, rollback |
| `server/lib/renderStateEmail.js` | Banner and subject wrapping, plus the fallback email |
| `server/services/workflowExecutionService.js` | `prepareNotificationMode` / `applyStateEngine` hook into `executeRun` |
| `ui/src/components/workflow-builder/AlertStatePanel.jsx` | Builder settings |
| `ui/src/components/StateEngineViews.jsx` | Workflow and run state views |

API:

- `GET /tenants/:tenantId/workflows/:workflowId/state`
- `GET /tenants/:tenantId/workflows/:workflowId/state/evaluations?limit=`
