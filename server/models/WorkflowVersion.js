const mongoose = require('mongoose');

const WorkflowVersionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, default: null, index: true },
    scope: { type: String, enum: ['tenant', 'global'], default: 'tenant', index: true },
    workflowId: { type: String, required: true },
    version: { type: String, required: true },
    definitionJson: { type: Object, required: true }
  },
  { timestamps: true }
);

WorkflowVersionSchema.index(
  { tenantId: 1, workflowId: 1, version: 1 },
  { unique: true }
);
WorkflowVersionSchema.index({ scope: 1, workflowId: 1, version: 1 });

module.exports = mongoose.model('WorkflowVersion', WorkflowVersionSchema);
