const mongoose = require('mongoose');

const ProcessedBrokerEventSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    eventId: { type: String, required: true },
    eventType: { type: String, required: true, index: true },
    alertId: { type: Number, index: true },
    idempotencyKey: { type: String, required: true },
    occurredAt: { type: Date },
    status: {
      type: String,
      enum: ['processing', 'applied', 'duplicate', 'stale', 'failed'],
      default: 'processing'
    },
    errorCode: { type: String },
    errorMessage: { type: String },
    sideEffects: { type: Object, default: {} },
    source: { type: String },
    schemaVersion: { type: String }
  },
  { timestamps: true }
);

ProcessedBrokerEventSchema.index({ tenantId: 1, eventId: 1 }, { unique: true });
ProcessedBrokerEventSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
ProcessedBrokerEventSchema.index({ tenantId: 1, eventType: 1, createdAt: -1 });

module.exports = mongoose.model('ProcessedBrokerEvent', ProcessedBrokerEventSchema);
