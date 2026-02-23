const express = require('express');
const WorkflowRun = require('../models/WorkflowRun');
const AlertShadow = require('../models/AlertShadow');
const ProcessedBrokerEvent = require('../models/ProcessedBrokerEvent');

const router = express.Router({ mergeParams: true });

router.get('/queue', async (req, res, next) => {
  try {
    const { tenantId } = req.params;

    const [queued, running, deferred, retrying, deadLetter] = await Promise.all([
      WorkflowRun.countDocuments({ tenantId, status: 'queued' }),
      WorkflowRun.countDocuments({ tenantId, status: 'running' }),
      WorkflowRun.countDocuments({ tenantId, status: 'deferred' }),
      WorkflowRun.countDocuments({ tenantId, status: 'retrying' }),
      WorkflowRun.countDocuments({ tenantId, status: 'dead_letter' })
    ]);

    res.json({
      queue: {
        queued,
        running,
        deferred,
        retrying,
        deadLetter
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/alerts-shadow', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { alertType, scope, status, limit = 100 } = req.query;

    const query = { tenantId };
    if (alertType) query.alertType = alertType;
    if (scope) query.scope = scope;
    if (status) query.status = status;

    const rows = await AlertShadow.find(query)
      .sort({ updatedAt: -1 })
      .limit(Math.min(Number(limit) || 100, 500))
      .lean();

    res.json({ alertsShadow: rows });
  } catch (error) {
    next(error);
  }
});

router.get('/events/processed', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { eventType, alertId, status, limit = 100 } = req.query;

    const query = { tenantId };
    if (eventType) query.eventType = eventType;
    if (alertId) query.alertId = Number(alertId);
    if (status) query.status = status;

    const events = await ProcessedBrokerEvent.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 100, 500))
      .lean();

    res.json({ events });
  } catch (error) {
    next(error);
  }
});

router.post('/runs/:runId/retry', async (req, res, next) => {
  try {
    const { tenantId, runId } = req.params;
    const run = await WorkflowRun.findOne({ _id: runId, tenantId });
    if (!run) return res.status(404).json({ error: 'run not found' });

    if (!['failed', 'dead_letter', 'canceled'].includes(run.status)) {
      return res.status(400).json({ error: `run in status ${run.status} cannot be retried` });
    }

    run.status = 'queued';
    run.nextRetryAt = null;
    run.finishedAt = null;
    run.lastError = null;
    await run.save();

    res.json({ runId: run._id, status: run.status });
  } catch (error) {
    next(error);
  }
});

router.post('/runs/:runId/cancel', async (req, res, next) => {
  try {
    const { tenantId, runId } = req.params;
    const run = await WorkflowRun.findOne({ _id: runId, tenantId });
    if (!run) return res.status(404).json({ error: 'run not found' });

    if (!['queued', 'deferred', 'retrying'].includes(run.status)) {
      return res.status(400).json({ error: `run in status ${run.status} cannot be canceled` });
    }

    run.status = 'canceled';
    run.finishedAt = new Date();
    run.lastError = 'canceled_by_operator';
    await run.save();

    res.json({ runId: run._id, status: run.status });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
