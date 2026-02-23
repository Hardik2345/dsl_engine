const mongoose = require('mongoose');

const MissedTriggerSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    workflowId: { type: String, required: true, index: true },
    scheduleId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    intendedRunAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['pending_replay', 'replayed', 'discarded'],
      default: 'pending_replay'
    },
    replayedAt: { type: Date },
    replayRunId: { type: mongoose.Schema.Types.ObjectId }
  },
  { timestamps: true }
);

MissedTriggerSchema.index({ scheduleId: 1, intendedRunAt: 1 }, { unique: true });

module.exports = mongoose.model('MissedTrigger', MissedTriggerSchema);
