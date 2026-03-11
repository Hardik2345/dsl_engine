const express = require('express');
const WorkflowSchedule = require('../models/WorkflowSchedule');
const MissedTrigger = require('../models/MissedTrigger');
const { createSchedule, replayMissedTriggers } = require('../../scheduler/app/schedulerService');
const { getNextRunAt, isTopOfHourCronExpr } = require('../../scheduler/app/cronUtils');
const {
  SCHEDULE_WINDOW_MODES,
  SCHEDULE_WINDOW_MODE_VALUES
} = require('../../scheduler/app/scheduleWindowModes');

const router = express.Router({ mergeParams: true });

router.post('/:workflowId/schedules', async (req, res, next) => {
  try {
    const { tenantId, workflowId } = req.params;
    const { cronExpr, timezone, windowMode = SCHEDULE_WINDOW_MODES.PREVIOUS_COMPLETE_DAY } = req.body || {};

    if (!cronExpr) {
      return res.status(400).json({ error: 'cronExpr is required' });
    }

    if (timezone && timezone !== 'UTC') {
      return res.status(400).json({ error: 'timezone must be UTC for MVP' });
    }

    if (!SCHEDULE_WINDOW_MODE_VALUES.includes(windowMode)) {
      return res.status(400).json({ error: `windowMode must be one of ${SCHEDULE_WINDOW_MODE_VALUES.join(', ')}` });
    }

    if (
      windowMode === SCHEDULE_WINDOW_MODES.DAY_TO_DATE_VS_PREVIOUS_DAY
      && !isTopOfHourCronExpr(cronExpr)
    ) {
      return res.status(400).json({ error: 'day_to_date_vs_previous_day requires a top-of-hour cron expression (minute must be 0)' });
    }

    const schedule = await createSchedule({
      tenantId,
      workflowId,
      payload: req.body || {}
    });

    res.status(201).json({ schedule });
  } catch (error) {
    next(error);
  }
});

router.get('/:workflowId/schedules', async (req, res, next) => {
  try {
    const { tenantId, workflowId } = req.params;
    const schedules = await WorkflowSchedule.find({ tenantId, workflowId })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ schedules });
  } catch (error) {
    next(error);
  }
});

router.patch('/:workflowId/schedules/:scheduleId', async (req, res, next) => {
  try {
    const { tenantId, workflowId, scheduleId } = req.params;

    const updates = {};
    ['name', 'cronExpr', 'overlapPolicy', 'retryPolicy', 'isActive', 'windowMode'].forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    if (
      updates.windowMode !== undefined
      && !SCHEDULE_WINDOW_MODE_VALUES.includes(updates.windowMode)
    ) {
      return res.status(400).json({ error: `windowMode must be one of ${SCHEDULE_WINDOW_MODE_VALUES.join(', ')}` });
    }

    const effectiveCronExpr = updates.cronExpr || req.body.cronExpr;
    const nextWindowMode = updates.windowMode || undefined;
    const targetWindowMode = nextWindowMode;

    const current = await WorkflowSchedule.findOne({ _id: scheduleId, tenantId, workflowId }).lean();
    if (!current) return res.status(404).json({ error: 'schedule not found' });

    const resolvedWindowMode = targetWindowMode || current.windowMode || SCHEDULE_WINDOW_MODES.PREVIOUS_COMPLETE_DAY;
    const resolvedCronExpr = effectiveCronExpr || current.cronExpr;

    if (
      resolvedWindowMode === SCHEDULE_WINDOW_MODES.DAY_TO_DATE_VS_PREVIOUS_DAY
      && !isTopOfHourCronExpr(resolvedCronExpr)
    ) {
      return res.status(400).json({ error: 'day_to_date_vs_previous_day requires a top-of-hour cron expression (minute must be 0)' });
    }

    if (updates.cronExpr) {
      updates.nextRunAt = getNextRunAt(updates.cronExpr, new Date());
    }

    const schedule = await WorkflowSchedule.findOneAndUpdate(
      { _id: scheduleId, tenantId, workflowId },
      { $set: updates },
      { new: true }
    );

    res.json({ schedule });
  } catch (error) {
    next(error);
  }
});

router.post('/:workflowId/schedules/:scheduleId/pause', async (req, res, next) => {
  try {
    const { tenantId, workflowId, scheduleId } = req.params;
    const schedule = await WorkflowSchedule.findOneAndUpdate(
      { _id: scheduleId, tenantId, workflowId },
      { $set: { isActive: false, pausedAt: new Date() } },
      { new: true }
    );

    if (!schedule) return res.status(404).json({ error: 'schedule not found' });
    res.json({ schedule });
  } catch (error) {
    next(error);
  }
});

router.post('/:workflowId/schedules/:scheduleId/resume', async (req, res, next) => {
  try {
    const { tenantId, workflowId, scheduleId } = req.params;
    const current = await WorkflowSchedule.findOne({ _id: scheduleId, tenantId, workflowId }).lean();
    if (!current) return res.status(404).json({ error: 'schedule not found' });

    const schedule = await WorkflowSchedule.findOneAndUpdate(
      { _id: scheduleId, tenantId, workflowId },
      {
        $set: {
          isActive: true,
          nextRunAt: getNextRunAt(current.cronExpr, new Date())
        },
        $unset: { pausedAt: 1 }
      },
      { new: true }
    );

    res.json({ schedule });
  } catch (error) {
    next(error);
  }
});

router.post('/:workflowId/schedules/:scheduleId/replay-missed', async (req, res, next) => {
  try {
    const { tenantId, workflowId, scheduleId } = req.params;
    const schedule = await WorkflowSchedule.findOne({ _id: scheduleId, tenantId, workflowId }).lean();
    if (!schedule) return res.status(404).json({ error: 'schedule not found' });

    const replayed = await replayMissedTriggers(scheduleId);

    res.json({ replayedCount: replayed.length, replayed });
  } catch (error) {
    next(error);
  }
});

router.delete('/:workflowId/schedules/:scheduleId', async (req, res, next) => {
  try {
    const { tenantId, workflowId, scheduleId } = req.params;

    const schedule = await WorkflowSchedule.findOneAndDelete({
      _id: scheduleId,
      tenantId,
      workflowId
    });

    if (!schedule) {
      return res.status(404).json({ error: 'schedule not found' });
    }

    await MissedTrigger.deleteMany({ tenantId, workflowId, scheduleId });

    res.json({ deleted: true, scheduleId });
  } catch (error) {
    next(error);
  }
});

router.get('/:workflowId/schedules/:scheduleId/missed', async (req, res, next) => {
  try {
    const { tenantId, workflowId, scheduleId } = req.params;

    const missed = await MissedTrigger.find({ tenantId, workflowId, scheduleId })
      .sort({ intendedRunAt: -1 })
      .lean();

    res.json({ missed });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
