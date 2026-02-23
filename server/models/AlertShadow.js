const mongoose = require('mongoose');

const AlertShadowSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    brandId: { type: Number, required: true, index: true },
    alertId: { type: Number, required: true },
    name: { type: String },
    alertType: { type: String, index: true },
    scope: { type: String, enum: ['single', 'multiple', 'global'], default: 'single' },
    status: { type: String, default: 'active' },
    metricName: { type: String },
    metricType: { type: String },
    thresholdType: { type: String },
    thresholdValue: { type: Number },
    criticalThreshold: { type: Number },
    severity: { type: String },
    cooldownMinutes: { type: Number },
    sourceUpdatedAt: { type: Date },
    configVersion: { type: Number },
    isDeleted: { type: Boolean, default: false },
    lastConfigEventId: { type: String },
    payloadHash: { type: String },
    lastFiredAt: { type: Date }
  },
  { timestamps: true }
);

AlertShadowSchema.index({ tenantId: 1, alertId: 1 }, { unique: true });
AlertShadowSchema.index({ tenantId: 1, alertType: 1, scope: 1, status: 1 });

module.exports = mongoose.model('AlertShadow', AlertShadowSchema);
