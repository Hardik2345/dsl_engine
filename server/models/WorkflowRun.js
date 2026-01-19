const mongoose = require('mongoose');

const WorkflowRunSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    workflowId: { type: String, required: true },
    version: { type: String, required: true },
    status: { type: String, required: true },
    context: { type: Object, required: true },
    metrics: { type: Object },
    executionTrace: { type: Array },
    nodeOutputs: { type: Array },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date }
  },
  { timestamps: true }
);

WorkflowRunSchema.index({ tenantId: 1, workflowId: 1, startedAt: -1 });

module.exports = mongoose.model('WorkflowRun', WorkflowRunSchema);
