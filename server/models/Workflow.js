const mongoose = require('mongoose');

const WorkflowSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    workflowId: { type: String, required: true },
    name: { type: String },
    latestVersion: { type: String, required: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

WorkflowSchema.index({ tenantId: 1, workflowId: 1 }, { unique: true });

module.exports = mongoose.model('Workflow', WorkflowSchema);
