const express = require('express');
const NotificationLedger = require('../models/NotificationLedger');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { workflowId, runId, stateKey, status } = req.query;

    const query = { tenantId };
    if (workflowId) query.workflowId = workflowId;
    if (runId) query.runId = runId;
    if (stateKey) query.stateKey = stateKey;
    if (status) query.status = status;

    const notifications = await NotificationLedger.find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      // Rendered content can be large and isn't needed for the list view.
      .select('-renderedHtml -renderedText -pendingStateSnapshot')
      .lean();
    res.json({ notifications });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { tenantId, id } = req.params;
    const notification = await NotificationLedger.findOne({ _id: id, tenantId }).lean();
    if (!notification) return res.status(404).json({ error: 'notification not found' });
    res.json({ notification });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
