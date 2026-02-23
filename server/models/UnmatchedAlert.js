const mongoose = require('mongoose');

const UnmatchedAlertSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    brand: { type: String, required: true, index: true },
    alertType: { type: String, required: true, index: true },
    idempotencyKey: { type: String, required: true },
    occurredAt: { type: Date, required: true },
    payload: { type: Object, default: {} },
    reason: { type: String, required: true }
  },
  { timestamps: true }
);

UnmatchedAlertSchema.index({ tenantId: 1, alertType: 1, createdAt: -1 });

module.exports = mongoose.model('UnmatchedAlert', UnmatchedAlertSchema);
