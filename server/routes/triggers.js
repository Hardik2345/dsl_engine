const express = require('express');
const TriggerEvent = require('../models/TriggerEvent');
const UnmatchedAlert = require('../models/UnmatchedAlert');
const { ingestEventTrigger } = require('../../scheduler/app/schedulerService');

const router = express.Router({ mergeParams: true });
const DEBUG_ALERT_EVENTS = String(process.env.DEBUG_ALERT_EVENTS || '').toLowerCase() === 'true';

router.post('/events', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { alertType, idempotencyKey } = req.body || {};
    if (DEBUG_ALERT_EVENTS) {
      console.log('[alert-events] received-http', {
        tenantId,
        alertType: req.body?.alertType || null,
        idempotencyKey: req.body?.idempotencyKey || null,
        brand: req.body?.brand || null,
        occurredAt: req.body?.occurredAt || null
      });
    }

    if (!alertType) {
      return res.status(400).json({ error: 'alertType is required' });
    }

    if (!idempotencyKey) {
      return res.status(400).json({ error: 'idempotencyKey is required' });
    }

    const result = await ingestEventTrigger({ tenantId, body: req.body || {} });

    if (result.duplicate) {
      const matchedWorkflowIds = result.triggerEvent.matchedWorkflowIds || (result.triggerEvent.matchedWorkflowId ? [result.triggerEvent.matchedWorkflowId] : []);
      const enqueuedRunIds = result.triggerEvent.runIds || (result.triggerEvent.runId ? [result.triggerEvent.runId] : []);
      return res.status(200).json({
        accepted: true,
        duplicate: true,
        matchedWorkflowId: result.triggerEvent.matchedWorkflowId || null,
        matchedWorkflowIds,
        enqueuedRunId: result.triggerEvent.runId || null,
        enqueuedRunIds,
        reason: 'duplicate_idempotency_key'
      });
    }

    if (result.unmatched) {
      return res.status(202).json({
        accepted: true,
        duplicate: false,
        matchedWorkflowId: null,
        enqueuedRunId: null,
        reason: 'no_matching_workflow'
      });
    }

    if (result.skipped) {
      return res.status(202).json({
        accepted: true,
        duplicate: false,
        matchedWorkflowId: result.triggerEvent.matchedWorkflowId || null,
        matchedWorkflowIds: result.triggerEvent.matchedWorkflowIds || [],
        enqueuedRunId: null,
        enqueuedRunIds: [],
        reason: result.triggerEvent.reason || 'queue_policy_skipped'
      });
    }

    return res.status(202).json({
      accepted: true,
      duplicate: false,
      matchedWorkflowId: result.triggerEvent.matchedWorkflowId,
      matchedWorkflowIds: result.triggerEvent.matchedWorkflowIds || (result.triggerEvent.matchedWorkflowId ? [result.triggerEvent.matchedWorkflowId] : []),
      enqueuedRunId: result.run?._id || null,
      enqueuedRunIds: result.triggerEvent.runIds || (result.run?._id ? [result.run._id] : []),
      enqueuedCount: result.enqueuedCount || ((result.triggerEvent.runIds || []).length || (result.run?._id ? 1 : 0)),
      skippedCount: result.skippedCount || 0,
      reason: null
    });
  } catch (error) {
    next(error);
  }
});

router.get('/events', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const events = await TriggerEvent.find({ tenantId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ events });
  } catch (error) {
    next(error);
  }
});

router.get('/unmatched', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const alerts = await UnmatchedAlert.find({ tenantId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ alerts });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
