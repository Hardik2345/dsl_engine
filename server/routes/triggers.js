const express = require('express');
const TriggerEvent = require('../models/TriggerEvent');
const UnmatchedAlert = require('../models/UnmatchedAlert');
const { ingestEventTrigger } = require('../../scheduler/app/schedulerService');

const router = express.Router({ mergeParams: true });

router.post('/events', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { alertType, idempotencyKey } = req.body || {};

    if (!alertType) {
      return res.status(400).json({ error: 'alertType is required' });
    }

    if (!idempotencyKey) {
      return res.status(400).json({ error: 'idempotencyKey is required' });
    }

    const result = await ingestEventTrigger({ tenantId, body: req.body || {} });

    if (result.duplicate) {
      return res.status(200).json({
        accepted: true,
        duplicate: true,
        matchedWorkflowId: result.triggerEvent.matchedWorkflowId || null,
        enqueuedRunId: result.triggerEvent.runId || null,
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
        enqueuedRunId: null,
        reason: result.triggerEvent.reason || 'queue_policy_skipped'
      });
    }

    return res.status(202).json({
      accepted: true,
      duplicate: false,
      matchedWorkflowId: result.triggerEvent.matchedWorkflowId,
      enqueuedRunId: result.run?._id || null,
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
