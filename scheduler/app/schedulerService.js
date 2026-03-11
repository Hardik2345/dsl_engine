const Workflow = require('../../server/models/Workflow');
const WorkflowVersion = require('../../server/models/WorkflowVersion');
const WorkflowSchedule = require('../../server/models/WorkflowSchedule');
const TriggerEvent = require('../../server/models/TriggerEvent');
const UnmatchedAlert = require('../../server/models/UnmatchedAlert');
const MissedTrigger = require('../../server/models/MissedTrigger');
const { selectWorkflowMatches } = require('../domain/triggerMatcher');
const {
  getNextRunAt,
  listMissedRuns,
  getTimeZoneParts,
  localDateTimeToUtc
} = require('./cronUtils');
const { enqueueRun } = require('./runQueueService');
const { resolveWorkflowVersion } = require('../../server/services/workflowExecutionService');
const { SCHEDULE_WINDOW_MODES } = require('./scheduleWindowModes');

async function getWorkflowCandidates(tenantId, includeGlobal = true) {
  const clauses = [{ tenantId, isActive: true }];
  if (includeGlobal) {
    clauses.push({ scope: 'global', tenantId: null, isActive: true });
  }

  const workflows = await Workflow.find({ $or: clauses }).lean();
  const candidates = await Promise.all(workflows.map(async (workflow) => {
    const scope = workflow.scope || 'tenant';
    const scopeClause = scope === 'global'
      ? { scope: 'global' }
      : { $or: [{ scope: 'tenant' }, { scope: { $exists: false } }] };

    const version = await WorkflowVersion.findOne({
      tenantId: workflow.tenantId ?? null,
      workflowId: workflow.workflowId,
      version: workflow.latestVersion,
      ...scopeClause
    }).lean();

    return {
      workflow,
      definition: version?.definitionJson || null
    };
  }));

  return candidates.filter(item => item.definition);
}

function buildDefaultContext(tenantId, payload) {
  const now = new Date().toISOString();
  const bodyContext = payload?.context;
  if (bodyContext && typeof bodyContext === 'object') return bodyContext;

  return {
    meta: {
      tenantId,
      metric: payload?.metric || 'cvr',
      triggeredAt: payload?.occurredAt || now,
      window: payload?.window || { start: now, end: now },
      baselineWindow: payload?.baselineWindow || { start: now, end: now }
    },
    filters: payload?.filters || [],
    metrics: payload?.metrics || {},
    rootCausePath: [],
    scratch: {}
  };
}

function toIsoUtc(date) {
  return new Date(date).toISOString();
}

function startOfDay(dateInput, timeZone = 'UTC') {
  const parts = getTimeZoneParts(new Date(dateInput), timeZone);
  return localDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0
  }, timeZone);
}

function buildPreviousCompleteDayContext(tenantId, triggerTime, payload = {}, timeZone = 'UTC') {
  const triggerDate = new Date(triggerTime);
  const triggerParts = getTimeZoneParts(triggerDate, timeZone);
  const currentDayStart = startOfDay(triggerDate, timeZone);
  const previousDayStart = localDateTimeToUtc({
    year: triggerParts.year,
    month: triggerParts.month,
    day: triggerParts.day - 1,
    hour: 0,
    minute: 0,
    second: 0
  }, timeZone);
  const baselineDayStart = localDateTimeToUtc({
    year: triggerParts.year,
    month: triggerParts.month,
    day: triggerParts.day - 2,
    hour: 0,
    minute: 0,
    second: 0
  }, timeZone);

  return {
    meta: {
      tenantId,
      metric: payload?.metric || 'cvr',
      triggeredAt: toIsoUtc(triggerDate),
      window: {
        start: toIsoUtc(previousDayStart),
        end: toIsoUtc(currentDayStart)
      },
      baselineWindow: {
        start: toIsoUtc(baselineDayStart),
        end: toIsoUtc(previousDayStart)
      }
    },
    filters: payload?.filters || [],
    metrics: payload?.metrics || {},
    rootCausePath: [],
    scratch: {}
  };
}

function buildDayToDateVsPreviousDayContext(tenantId, triggerTime, payload = {}, timeZone = 'UTC') {
  const triggerDate = new Date(triggerTime);
  const triggerParts = getTimeZoneParts(triggerDate, timeZone);
  const currentDayStart = startOfDay(triggerDate, timeZone);
  const previousDayStart = localDateTimeToUtc({
    year: triggerParts.year,
    month: triggerParts.month,
    day: triggerParts.day - 1,
    hour: 0,
    minute: 0,
    second: 0
  }, timeZone);
  const previousDayCutoff = localDateTimeToUtc({
    year: triggerParts.year,
    month: triggerParts.month,
    day: triggerParts.day - 1,
    hour: triggerParts.hour,
    minute: triggerParts.minute,
    second: triggerParts.second
  }, timeZone);

  return {
    meta: {
      tenantId,
      metric: payload?.metric || 'cvr',
      triggeredAt: toIsoUtc(triggerDate),
      window: {
        start: toIsoUtc(currentDayStart),
        end: toIsoUtc(triggerDate)
      },
      baselineWindow: {
        start: toIsoUtc(previousDayStart),
        end: toIsoUtc(previousDayCutoff)
      }
    },
    filters: payload?.filters || [],
    metrics: payload?.metrics || {},
    rootCausePath: [],
    scratch: {}
  };
}

function buildCronContext(schedule, triggerTime, payload = {}) {
  const mode = schedule?.windowMode || SCHEDULE_WINDOW_MODES.PREVIOUS_COMPLETE_DAY;
  const timeZone = schedule?.timezone || 'UTC';

  if (mode === SCHEDULE_WINDOW_MODES.DAY_TO_DATE_VS_PREVIOUS_DAY) {
    return buildDayToDateVsPreviousDayContext(schedule.tenantId, triggerTime, payload, timeZone);
  }

  return buildPreviousCompleteDayContext(schedule.tenantId, triggerTime, payload, timeZone);
}

async function ingestEventTrigger({ tenantId, body }) {
  const brand = body.brand || tenantId;
  const alertType = body.alertType;
  const idempotencyKey = body.idempotencyKey;

  const existing = await TriggerEvent.findOne({ tenantId, idempotencyKey }).lean();
  if (existing) {
    return {
      duplicate: true,
      triggerEvent: existing,
      run: existing.runId ? { _id: existing.runId } : null
    };
  }

  let triggerEvent;
  try {
    triggerEvent = await TriggerEvent.create({
      tenantId,
      brand,
      alertType,
      idempotencyKey,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      payload: body.payload || {},
      status: 'accepted'
    });
  } catch (error) {
    if (error && error.code === 11000) {
      const duplicate = await TriggerEvent.findOne({ tenantId, idempotencyKey }).lean();
      return {
        duplicate: true,
        triggerEvent: duplicate,
        run: duplicate?.runId ? { _id: duplicate.runId } : null
      };
    }
    throw error;
  }

  const candidates = await getWorkflowCandidates(tenantId, true);
  const matches = selectWorkflowMatches(candidates, brand, alertType);

  if (!matches.length) {
    await UnmatchedAlert.create({
      tenantId,
      brand,
      alertType,
      idempotencyKey,
      occurredAt: triggerEvent.occurredAt,
      payload: body.payload || {},
      reason: 'no_matching_workflow'
    });

    triggerEvent.status = 'unmatched';
    triggerEvent.reason = 'no_matching_workflow';
    await triggerEvent.save();

    return { duplicate: false, triggerEvent, run: null, unmatched: true };
  }

  const context = buildDefaultContext(tenantId, {
    ...body.payload,
    occurredAt: triggerEvent.occurredAt
  });

  const enqueued = [];
  const skipped = [];

  for (const match of matches) {
    const workflowId = match.workflow.workflowId;
    const { workflowVersion, versionId } = await resolveWorkflowVersion({
      tenantId,
      workflowId,
      version: match.workflow.latestVersion
    });

    const queued = await enqueueRun({
      tenantId,
      workflowId,
      version: versionId,
      context,
      definitionJson: workflowVersion.definitionJson,
      triggerType: 'event',
      triggerRef: triggerEvent._id,
      overlapPolicy: 'queue_one_pending',
      maxAttempts: 3
    });

    if (!queued.enqueued) {
      skipped.push({ workflowId, reason: queued.reason || 'not_enqueued' });
      continue;
    }

    enqueued.push({
      workflowId,
      versionId,
      runId: queued.run._id
    });
  }

  if (!enqueued.length) {
    triggerEvent.status = 'failed';
    triggerEvent.reason = skipped[0]?.reason || 'no_runs_enqueued';
    await triggerEvent.save();

    return {
      duplicate: false,
      triggerEvent,
      run: null,
      runs: [],
      unmatched: false,
      skipped: true
    };
  }

  triggerEvent.status = 'enqueued';
  triggerEvent.matchedWorkflowId = enqueued[0].workflowId;
  triggerEvent.matchedVersion = enqueued[0].versionId;
  triggerEvent.runId = enqueued[0].runId;
  triggerEvent.matchedWorkflowIds = enqueued.map(item => item.workflowId);
  triggerEvent.matchedVersions = enqueued.map(item => item.versionId);
  triggerEvent.runIds = enqueued.map(item => item.runId);
  if (skipped.length) {
    triggerEvent.reason = `partially_enqueued:${skipped.length}`;
  }
  await triggerEvent.save();

  return {
    duplicate: false,
    triggerEvent,
    run: { _id: enqueued[0].runId },
    runs: enqueued.map(item => ({ _id: item.runId, workflowId: item.workflowId, version: item.versionId })),
    unmatched: false,
    enqueuedCount: enqueued.length,
    skippedCount: skipped.length
  };
}

async function createSchedule({ tenantId, workflowId, payload }) {
  const now = new Date();
  const nextRunAt = getNextRunAt(payload.cronExpr, now, payload.timezone || 'UTC');

  return WorkflowSchedule.create({
    tenantId,
    workflowId,
    name: payload.name || `${workflowId}-schedule`,
    cronExpr: payload.cronExpr,
    timezone: payload.timezone || 'UTC',
    windowMode: payload.windowMode || SCHEDULE_WINDOW_MODES.PREVIOUS_COMPLETE_DAY,
    isActive: payload.isActive !== false,
    overlapPolicy: payload.overlapPolicy || 'queue_one_pending',
    retryPolicy: payload.retryPolicy || { maxAttempts: 3, backoffSeconds: [30, 120, 600] },
    nextRunAt,
    lastEvaluatedAt: now
  });
}

async function evaluateDueSchedules(now = new Date()) {
  const schedules = await WorkflowSchedule.find({
    triggerType: 'cron',
    isActive: true,
    nextRunAt: { $lte: now }
  }).lean();

  const results = [];

  for (const schedule of schedules) {
    const { workflowVersion, versionId } = await resolveWorkflowVersion({
      tenantId: schedule.tenantId,
      workflowId: schedule.workflowId,
      version: null
    });

    const scheduledRunTime = schedule.nextRunAt || now;
    const context = buildCronContext(schedule, scheduledRunTime, {
      metric: 'cvr'
    });

    const queued = await enqueueRun({
      tenantId: schedule.tenantId,
      workflowId: schedule.workflowId,
      version: versionId,
      context,
      definitionJson: workflowVersion.definitionJson,
      triggerType: 'cron',
      triggerRef: schedule._id,
      overlapPolicy: schedule.overlapPolicy,
      maxAttempts: schedule.retryPolicy?.maxAttempts || 3
    });

    const nextRunAt = getNextRunAt(schedule.cronExpr, now, schedule.timezone || 'UTC');
    await WorkflowSchedule.updateOne(
      { _id: schedule._id },
      {
        $set: {
          nextRunAt,
          lastEvaluatedAt: now,
          lastTriggeredAt: queued.enqueued ? now : schedule.lastTriggeredAt || null
        }
      }
    );

    results.push({
      scheduleId: schedule._id,
      workflowId: schedule.workflowId,
      enqueued: queued.enqueued,
      reason: queued.reason || null,
      runId: queued.run?._id || null
    });
  }

  return results;
}

async function recordMissedTriggers(scheduleId, fromTime, toTime) {
  const schedule = await WorkflowSchedule.findById(scheduleId).lean();
  if (!schedule) return [];

  const missedRuns = listMissedRuns(
    schedule.cronExpr,
    fromTime,
    toTime,
    500,
    schedule.timezone || 'UTC'
  );
  const records = [];
  for (const runAt of missedRuns) {
    try {
      const item = await MissedTrigger.create({
        tenantId: schedule.tenantId,
        workflowId: schedule.workflowId,
        scheduleId: schedule._id,
        intendedRunAt: runAt
      });
      records.push(item);
    } catch (error) {
      if (error && error.code === 11000) continue;
      throw error;
    }
  }
  return records;
}

async function replayMissedTriggers(scheduleId) {
  const schedule = await WorkflowSchedule.findById(scheduleId).lean();
  if (!schedule) {
    const err = new Error('schedule not found');
    err.status = 404;
    throw err;
  }

  const pending = await MissedTrigger.find({
    scheduleId,
    status: 'pending_replay'
  }).sort({ intendedRunAt: 1 });

  const replayed = [];

  for (const missed of pending) {
    const { workflowVersion, versionId } = await resolveWorkflowVersion({
      tenantId: schedule.tenantId,
      workflowId: schedule.workflowId,
      version: null
    });

    const context = buildCronContext(schedule, missed.intendedRunAt, {
      metric: 'cvr'
    });

    const queued = await enqueueRun({
      tenantId: schedule.tenantId,
      workflowId: schedule.workflowId,
      version: versionId,
      context,
      definitionJson: workflowVersion.definitionJson,
      triggerType: 'cron',
      triggerRef: schedule._id,
      overlapPolicy: schedule.overlapPolicy,
      maxAttempts: schedule.retryPolicy?.maxAttempts || 3
    });

    if (!queued.enqueued) {
      continue;
    }

    missed.status = 'replayed';
    missed.replayedAt = new Date();
    missed.replayRunId = queued.run._id;
    await missed.save();

    replayed.push({ missedTriggerId: missed._id, runId: queued.run._id });
  }

  return replayed;
}

module.exports = {
  ingestEventTrigger,
  createSchedule,
  evaluateDueSchedules,
  recordMissedTriggers,
  replayMissedTriggers
};
