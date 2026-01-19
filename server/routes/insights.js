const express = require('express');
const Insight = require('../models/Insight');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { workflowId, runId } = req.query;

    const query = { tenantId };
    if (workflowId) query.workflowId = workflowId;
    if (runId) query.runId = runId;

    const insights = await Insight.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ insights });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
