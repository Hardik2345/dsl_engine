const mongoose = require('mongoose');

const DEFAULT_RESOLVED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const CurrentEpisodeSchema = new mongoose.Schema(
  {
    id: { type: String },
    startedAt: { type: Date },
    openedByRunId: { type: String },
    peakSeverityTier: { type: String, default: null },
    notifyCount: { type: Number, default: 0 },
    lastNotifiedAt: { type: Date },
    lastNotifiedMagnitude: { type: Number },
    lastNotifiedTransition: { type: String },
  },
  { _id: false }
);

const AlertStateSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    stateKey: { type: String, required: true },
    stateScope: {
      mode: { type: String, default: 'workflow' },
      group: { type: String, default: null },
      includeWindowMode: { type: Boolean, default: true },
    },
    workflowId: { type: String, index: true },
    workflowIdsSeen: { type: [String], default: [] },
    fingerprint: {
      hash: { type: String },
      metric: { type: String },
      direction: { type: String },
      outputKey: { type: String, default: null },
      ruleId: { type: String, default: null },
      dimension: { type: String },
      value: { type: String },
      path: { type: Array, default: [] },
      windowMode: { type: String, default: null },
    },
    displayLabel: { type: String },
    displayPath: { type: String },
    status: {
      type: String,
      enum: ['absent', 'new', 'active', 'recovering', 'resolved', 'stale', 'snoozed', 'muted'],
      default: 'absent',
      index: true,
    },
    severity: { type: String },
    severityTier: { type: String, default: null },
    firstSeenAt: { type: Date },
    lastSeenAt: { type: Date },
    lastObservationRunId: { type: String },
    lastObservationKey: { type: String },
    consecutiveBreach: { type: Number, default: 0 },
    consecutiveClean: { type: Number, default: 0 },
    inconclusiveStreak: { type: Number, default: 0 },
    episodeCount: { type: Number, default: 0 },
    currentEpisode: { type: CurrentEpisodeSchema, default: () => ({}) },
    resolvedAt: { type: Date, default: null },
    resolutionNotifiedAt: { type: Date, default: null },
    flapCount: { type: Number, default: 0 },
    flapWindowStartedAt: { type: Date, default: null },
    forcedDigestUntil: { type: Date, default: null },
    snoozedUntil: { type: Date, default: null },
    snoozedBy: { type: String, default: null },
    ackedAt: { type: Date, default: null },
    ackedBy: { type: String, default: null },
    mutedAt: { type: Date, default: null },
    mutedBy: { type: String, default: null },
    retentionExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Own pre-save hook, deliberately not copied from WorkflowRun.js's: that hook keys
// off a different set of terminal statuses plus finishedAt. A finding is only
// eligible for retention once it is resolved -- every other status (including
// snoozed/muted) must stay indefinitely since it's still an open concern.
AlertStateSchema.pre('save', function applyRetentionExpiry(next) {
  if (this.status !== 'resolved' || !this.resolvedAt) {
    this.retentionExpiresAt = null;
    return next();
  }
  this.retentionExpiresAt = new Date(this.resolvedAt.getTime() + DEFAULT_RESOLVED_RETENTION_MS);
  return next();
});

AlertStateSchema.index({ tenantId: 1, stateKey: 1 }, { unique: true });
AlertStateSchema.index({ tenantId: 1, status: 1, lastSeenAt: -1 });
AlertStateSchema.index({ tenantId: 1, workflowId: 1, status: 1 });
AlertStateSchema.index({ retentionExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AlertState', AlertStateSchema);
