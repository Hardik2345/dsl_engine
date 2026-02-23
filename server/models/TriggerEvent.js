const mongoose = require('mongoose');

const TriggerEventSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    brand: { type: String, required: true, index: true },
    alertType: { type: String, required: true, index: true },
    idempotencyKey: { type: String, required: true },
    occurredAt: { type: Date, required: true },
    payload: { type: Object, default: {} },
    matchedWorkflowId: { type: String },
    matchedVersion: { type: String },
    runId: { type: mongoose.Schema.Types.ObjectId },
    status: {
      type: String,
      enum: ['accepted', 'matched', 'enqueued', 'duplicate', 'unmatched', 'failed'],
      default: 'accepted'
    },
    reason: { type: String }
  },
  { timestamps: true }
);

TriggerEventSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
TriggerEventSchema.index({ tenantId: 1, alertType: 1, createdAt: -1 });

module.exports = mongoose.model('TriggerEvent', TriggerEventSchema);
