const mongoose = require('mongoose');

const NotificationSpoolItemSchema = new mongoose.Schema(
  {
    stateKey: { type: String, required: true },
    transition: { type: String, required: true },
    snapshot: { type: Object, default: {} },
    evidence: { type: Object, default: {} },
  },
  { _id: false }
);

const NotificationSpoolSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    digestKey: { type: String, required: true },
    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },
    mode: { type: String, default: 'burst_overflow' },
    items: { type: [NotificationSpoolItemSchema], default: [] },
    status: { type: String, enum: ['open', 'flushing', 'flushed'], default: 'open' },
    flushedAt: { type: Date },
    ledgerId: { type: String },
  },
  { timestamps: true }
);

NotificationSpoolSchema.index({ tenantId: 1, digestKey: 1 }, { unique: true });
NotificationSpoolSchema.index({ status: 1, windowEnd: 1 });

module.exports = mongoose.model('NotificationSpool', NotificationSpoolSchema);
