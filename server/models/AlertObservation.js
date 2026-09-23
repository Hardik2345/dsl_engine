const mongoose = require('mongoose');

const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const AlertObservationSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    stateKey: { type: String, required: true, index: true },
    runId: { type: String },
    observationKey: { type: String, required: true },
    observedAt: { type: Date, required: true },
    windowMode: { type: String },
    window: { type: Object },
    baselineWindow: { type: Object },
    breaching: { type: Boolean },
    conclusive: { type: Boolean },
    metrics: {
      current: { type: Number },
      baseline: { type: Number },
      delta_pct: { type: Number },
      sessions: { type: Number },
      share: { type: Number },
    },
    severityTier: { type: String, default: null },
    transition: { type: String },
    notified: { type: Boolean, default: false },
    expiresAt: { type: Date, default: () => new Date(Date.now() + DEFAULT_TTL_MS) },
  },
  { timestamps: true }
);

AlertObservationSchema.index({ tenantId: 1, stateKey: 1, observationKey: 1 }, { unique: true });
AlertObservationSchema.index({ tenantId: 1, stateKey: 1, observedAt: -1 });
AlertObservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AlertObservation', AlertObservationSchema);
