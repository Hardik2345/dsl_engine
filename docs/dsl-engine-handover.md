# DSL Engine Handover (Events, Processing, Runtime)

## 1. System Topology
1. API service (`npm run start`)
- Exposes workflow, run, schedule, trigger, insights, and alert-config HTTP bridge endpoints.
2. Worker service (`npm run start:worker`)
- Executes queued runs.
- Evaluates cron schedules.
- Consumes RabbitMQ alert events (when enabled).

## 2. Core Data Stores
1. MongoDB collections
- `Workflow`, `WorkflowVersion`
- `WorkflowRun` (authoritative run lifecycle state)
- `WorkflowSchedule`
- `TriggerEvent` (event trigger audit/idempotency for run-trigger path)
- `ProcessedBrokerEvent` (idempotency for broker/bridge envelopes)
- `AlertShadow` (config shadow of alerts system)
- `UnmatchedAlert`, `MissedTrigger`
2. RabbitMQ
- `alerts.events` (topic): alert config/fired events.
- `scheduler.runs` (direct): run dispatch messages (`{ runId }`).

## 3. Event Ingress Types Received by DSL Engine
1. Alert config events (for shadow sync, no workflow execution)
- `alert.config.created`
- `alert.config.updated`
- `alert.config.deleted`
2. Alert fired events (for workflow execution)
- `alert.fired`
3. HTTP trigger ingress (legacy/direct trigger path)
- `POST /tenants/:tenantId/triggers/events`
4. HTTP config bridge ingress (new)
- `POST /tenants/:tenantId/alerts/config-events`
- Accepts only `alert.config.*` envelope.

## 4. Locked Event Contract (Broker + HTTP Bridge)
Required top-level fields:
1. `eventId`
2. `eventType`
3. `occurredAt`
4. `source`
5. `idempotencyKey`
6. `tenantId`
7. `brandId`
8. `alertId`

Payload fields used commonly:
1. `alertType`
2. `scope` (currently `single` in alerts system)
3. `status`
4. `name`/`alertName`
5. metric/threshold metadata (`metricName`, `thresholdType`, etc.)

## 5. How Events Are Processed
1. Shared processor
- `scheduler/app/eventSubscriberService.js -> processEnvelope(envelope)`
2. Validation
- Checks required envelope fields.
- Rejects unsupported event types.
3. Idempotency
- Uses `ProcessedBrokerEvent`.
- Unique checks on `eventId` / `idempotencyKey` per tenant.
- Duplicate events are safely ignored.
4. Routing by `eventType`
- `alert.config.*` -> `handleAlertConfigEvent` -> upsert/tombstone `AlertShadow`.
- `alert.fired` -> `handleAlertFiredEvent` -> converts to scheduler trigger body -> run matching/enqueue path.
5. HTTP bridge route
- Calls same `processEnvelope`, so behavior matches broker path exactly.

## 6. How Workflow Selection Works for `alert.fired`
1. Load active workflow candidates for tenant (+ global candidates available in query).
2. Filter by trigger:
- `definition.trigger.alertType === event.alertType`
- Brand scope match via trigger config:
- `single|multiple` must include tenant/brand key in `trigger.brandIds`
- `global` match logic exists, but current fan-out path prioritizes brand-scoped matches.
3. Fan-out behavior (current)
- Enqueues all matched brand workflows for that alert type.
- Not single winner anymore.
4. Version policy
- Uses workflow `latestVersion`.
5. Overlap policy
- `queue_one_pending` behavior via run queue service.

## 7. Run Queue + Worker Lifecycle
1. Run creation
- API/scheduler creates `WorkflowRun` with `queued`/`deferred`.
2. Dispatch
- If backend is rabbit, publishes runId to `scheduler.runs`.
- Otherwise worker polls Mongo.
3. Worker execution states
- `queued -> running -> completed`
- failure path: `retrying -> dead_letter` (bounded retries)
4. Stored in `WorkflowRun`
- `status`, `attempt`, `nextRetryAt`, `lastError`, `triggerType`, etc.

## 8. Cron and Missed Trigger Behavior
1. Cron schedules live in `WorkflowSchedule`.
2. Worker cron loop evaluates due schedules.
3. Cron context window
- Previous complete UTC day (`D-1 00:00 -> D 00:00`).
- Baseline is day before that.
4. Missed triggers
- Stored in `MissedTrigger`.
- Replay is manual via schedule replay endpoint.

## 9. Key HTTP Endpoints
1. Trigger ingress
- `POST /tenants/:tenantId/triggers/events`
2. Trigger event audit
- `GET /tenants/:tenantId/triggers/events`
3. Unmatched alerts
- `GET /tenants/:tenantId/triggers/unmatched`
4. Config bridge
- `POST /tenants/:tenantId/alerts/config-events`
5. Schedules
- CRUD/pause/resume/replay-missed under `/tenants/:tenantId/workflows/:workflowId/schedules...`
6. Scheduler ops
- queue stats/retry/cancel under `/tenants/:tenantId/scheduler/...`

## 10. Security and Auth
1. CORS
- Restricted to `UI_ORIGIN` for browser traffic.
- Not relevant to server-to-server EC2 calls.
2. HTTP config bridge auth
- Optional shared secret env: `ALERTS_INGEST_TOKEN`
- Accepts bearer token or `x-alerts-ingest-token`.

## 11. Critical Env Variables
1. Common
- `MONGO_URI`
2. Worker toggles
- `SCHEDULER_RUN_EXECUTOR_ENABLED=true`
- `SCHEDULER_CRON_ENABLED=true`
- `SCHEDULER_ALERT_SUBSCRIBER_ENABLED=true|false`
3. Rabbit
- `RABBITMQ_URL`
- `RABBITMQ_STUB_MODE=false`
- `SCHEDULER_RUN_QUEUE_BACKEND=rabbit`
- Optional exchange/queue/prefetch vars.
4. Bridge auth
- `ALERTS_INGEST_TOKEN`
5. Debug (disable in prod)
- `DEBUG_ALERT_EVENTS`
- `DEBUG_RECURSIVE_BREAKDOWN`

## 12. Known Operational Gotchas
1. If both Rabbit config events and HTTP bridge send same envelope, duplicates are expected and safe.
2. Worker must run for async runs/cron/subscriber execution.
3. `RABBITMQ_URL` must use reachable host for that environment (Render internal host for Render-to-Render).
4. `guest/guest` is not recommended for exposed/public broker usage.

## 13. Recommended Operating Mode Right Now
1. Keep `alert.fired` on Rabbit.
2. Use exactly one channel for config CRUD to avoid duplicate noise.
- Either Rabbit `alert.config.*`, or HTTP bridge from EC2.
3. Keep idempotency keys stable and deterministic across retries.

