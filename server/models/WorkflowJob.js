const mongoose = require('mongoose');

const WorkflowJobSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['create_bulk_schedules'],
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
      index: true
    },
    workflowId: { type: String, default: null, index: true },
    scheduleGroupId: { type: String, default: null, index: true },
    tenantIds: { type: [String], default: [] },
    totalCount: { type: Number, default: 0 },
    processedCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    payload: { type: Object, required: true },
    result: {
      successes: { type: [Object], default: [] },
      failures: { type: [Object], default: [] }
    },
    error: { type: String },
    startedAt: { type: Date },
    completedAt: { type: Date }
  },
  { timestamps: true }
);

WorkflowJobSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('WorkflowJob', WorkflowJobSchema);
