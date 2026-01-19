const mongoose = require('mongoose');

const InsightSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    workflowId: { type: String, required: true },
    runId: { type: mongoose.Schema.Types.ObjectId, required: true },
    summary: { type: String, required: true },
    details: { type: Array, default: [] },
    confidence: { type: Number }
  },
  { timestamps: true }
);

InsightSchema.index({ tenantId: 1, workflowId: 1, createdAt: -1 });

module.exports = mongoose.model('Insight', InsightSchema);
