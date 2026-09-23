const mongoose = require('mongoose');

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

const NotificationLedgerSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    dedupeKey: { type: String, required: true },
    workflowId: { type: String, index: true },
    runId: { type: String, index: true },
    nodeId: { type: String },
    channel: { type: String, default: 'email' },
    recipients: { type: [String], default: [] },
    subject: { type: String },
    contentHash: { type: String, index: true },
    // Full §8.2 shape (Phase 1). Left as free strings rather than a hard enum so a
    // new suppressedReason can ship without a schema migration.
    stateKey: { type: String, index: true },
    stateKeys: { type: [String], default: undefined },
    transition: { type: String },
    episodeId: { type: String },
    observationKey: { type: String },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'suppressed', 'held', 'superseded'],
      default: 'pending'
    },
    suppressedReason: { type: String },
    heldUntil: { type: Date },
    required: { type: Boolean, default: false },
    attempt: { type: Number, default: 0 },
    nextAttemptAt: { type: Date },
    provider: { type: String },
    messageId: { type: String },
    sentAt: { type: Date },
    lastError: { type: String },
    // Gap #2 (design §11.4): a 'pending' row carries everything the delivery sweep
    // needs to actually send later, so the per-run suppression loop never blocks on
    // SMTP. renderedHtml/renderedText avoid re-rendering (and re-deriving `finding`)
    // in the sweep; pendingStateSnapshot carries the transition's computed nextState
    // so the sweep can bump currentEpisode.lastNotifiedAt only after a real send.
    renderedHtml: { type: String },
    renderedText: { type: String },
    pendingStateSnapshot: { type: mongoose.Schema.Types.Mixed },
    expiresAt: { type: Date, default: () => new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000) }
  },
  { timestamps: true }
);

NotificationLedgerSchema.index({ tenantId: 1, dedupeKey: 1 }, { unique: true });
NotificationLedgerSchema.index({ tenantId: 1, runId: 1 });
NotificationLedgerSchema.index({ tenantId: 1, workflowId: 1, contentHash: 1, status: 1, sentAt: -1 });
NotificationLedgerSchema.index({ tenantId: 1, stateKey: 1, createdAt: -1 });
NotificationLedgerSchema.index({ status: 1, nextAttemptAt: 1 });
NotificationLedgerSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('NotificationLedger', NotificationLedgerSchema);
