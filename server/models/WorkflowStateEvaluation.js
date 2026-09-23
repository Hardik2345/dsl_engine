const mongoose = require('mongoose');

const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Audit trail of state-engine decisions, one row per execution. Kept separate from
// WorkflowRun because runs are pruned to the latest four per workflow and expire
// after seven days (server/lib/retention.js), which is far too short to explain why
// an incident did or didn't notify.
const WorkflowStateEvaluationSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true },
    workflowId: { type: String, required: true },
    executionId: { type: String, required: true },
    executed_at: { type: Date, required: true },
    trigger_type: { type: String, default: null },
    automatic: { type: Boolean, default: false },
    // false when the run produced no usable finding value: no state change, no evidence.
    conclusive: { type: Boolean, default: true },
    previous_state: { type: String, default: null },
    resulting_state: { type: String, default: null },
    finding: { type: mongoose.Schema.Types.Mixed, default: null },
    notification: { type: mongoose.Schema.Types.Mixed, default: null },
    cooldown: { type: mongoose.Schema.Types.Mixed, default: null },
    quiet_hours: { type: mongoose.Schema.Types.Mixed, default: null },
    recovery: { type: mongoose.Schema.Types.Mixed, default: null },
    decision: { type: mongoose.Schema.Types.Mixed, default: null },
    delivery: {
      status: {
        type: String,
        enum: ['none', 'suppressed', 'pending', 'sending', 'sent', 'failed', 'uncertain'],
        default: 'none'
      },
      to: { type: [String], default: [] },
      subject: { type: String, default: null },
      messageId: { type: String, default: null },
      error: { type: String, default: null },
      sent_at: { type: Date, default: null },
      rolled_back: { type: Boolean, default: false }
    },
    expiresAt: { type: Date, default: () => new Date(Date.now() + DEFAULT_TTL_MS) }
  },
  { timestamps: true, collection: 'workflow_state_evaluations' }
);

WorkflowStateEvaluationSchema.index({ tenantId: 1, workflowId: 1, executionId: 1 }, { unique: true });
WorkflowStateEvaluationSchema.index({ tenantId: 1, workflowId: 1, executed_at: -1 });
WorkflowStateEvaluationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('WorkflowStateEvaluation', WorkflowStateEvaluationSchema);
