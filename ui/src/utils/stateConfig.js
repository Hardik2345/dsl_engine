// Client-side mirror of server/lib/stateEngine/defaults.js and the state_config
// checks in server/validation/workflowDefinition.js, so the builder can catch
// mistakes before a save round-trip. The server stays the source of truth.

export const WORKFLOW_PURPOSES = {
  RCA: 'rca',
  DAILY_INSIGHT: 'daily_insight',
};

export const MIN_REQUIRED_EVIDENCE = 2;

// Signed percent deltas produced by the metric_compare node.
export const STATE_METRIC_OPTIONS = [
  { value: 'cvr_delta_pct', label: 'CVR change %' },
  { value: 'sessions_delta_pct', label: 'Sessions change %' },
  { value: 'orders_delta_pct', label: 'Orders change %' },
  { value: 'atc_sessions_delta_pct', label: 'ATC sessions change %' },
  { value: 'atc_rate_delta_pct', label: 'ATC rate change %' },
];

export const STATE_DIRECTION_OPTIONS = [
  { value: 'drop', label: 'Drop', hint: 'A change of -17% counts as 17' },
  { value: 'rise', label: 'Rise', hint: 'A change of +17% counts as 17' },
  { value: 'absolute', label: 'Either way', hint: 'Both -17% and +17% count as 17' },
];

export const DEFAULT_STATE_CONFIG = {
  enabled: false,
  finding: { metric: 'cvr_delta_pct', direction: 'drop' },
  thresholds: { normal: 15, critical: 25 },
  cooldown: { triggered_minutes: 60, critical_minutes: 30 },
  recovery: { required_evidence: MIN_REQUIRED_EVIDENCE },
  quiet_hours: { enabled: false, start: '23:00', end: '07:00' },
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function getWorkflowPurpose(definition = {}) {
  return definition?.workflow_purpose === WORKFLOW_PURPOSES.DAILY_INSIGHT
    ? WORKFLOW_PURPOSES.DAILY_INSIGHT
    : WORKFLOW_PURPOSES.RCA;
}

export function getWorkflowPurposeLabel(definition = {}) {
  return getWorkflowPurpose(definition) === WORKFLOW_PURPOSES.DAILY_INSIGHT ? 'Daily insight' : 'RCA alert';
}

export function isStateEngineEnabled(definition = {}) {
  return getWorkflowPurpose(definition) === WORKFLOW_PURPOSES.RCA && definition?.state_config?.enabled === true;
}

// Fills any missing section with its default so the form always has a value to show.
export function withStateConfigDefaults(config) {
  const source = config || {};
  return {
    ...DEFAULT_STATE_CONFIG,
    ...source,
    finding: { ...DEFAULT_STATE_CONFIG.finding, ...(source.finding || {}) },
    thresholds: { ...DEFAULT_STATE_CONFIG.thresholds, ...(source.thresholds || {}) },
    cooldown: { ...DEFAULT_STATE_CONFIG.cooldown, ...(source.cooldown || {}) },
    recovery: { ...DEFAULT_STATE_CONFIG.recovery, ...(source.recovery || {}) },
    quiet_hours: { ...DEFAULT_STATE_CONFIG.quiet_hours, ...(source.quiet_hours || {}) },
  };
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isWholeAtLeast = (value, min) => Number.isInteger(value) && value >= min;

export function getStateConfigErrors(workflowJson = {}) {
  const errors = [];
  const config = workflowJson.state_config;
  if (!config || config.enabled !== true) return errors;

  if (getWorkflowPurpose(workflowJson) === WORKFLOW_PURPOSES.DAILY_INSIGHT) {
    errors.push('Alert state cannot be enabled for a daily insight workflow');
    return errors;
  }

  const { normal, critical } = config.thresholds || {};
  if (!isNumber(normal) || normal < 0) errors.push('Alert threshold must be a number of 0 or more');
  if (!isNumber(critical)) errors.push('Critical threshold must be a number');
  else if (isNumber(normal) && critical <= normal) errors.push('Critical threshold must be greater than the alert threshold');

  ['triggered_minutes', 'critical_minutes'].forEach((field) => {
    if (!isWholeAtLeast(config.cooldown?.[field], 0)) {
      errors.push(`${field === 'critical_minutes' ? 'Critical' : 'Triggered'} cooldown must be a whole number of minutes`);
    }
  });

  if (!isWholeAtLeast(config.recovery?.required_evidence, MIN_REQUIRED_EVIDENCE)) {
    errors.push(`Recovery needs at least ${MIN_REQUIRED_EVIDENCE} normal runs`);
  }

  if (config.quiet_hours?.enabled) {
    if (!HHMM_RE.test(config.quiet_hours.start || '') || !HHMM_RE.test(config.quiet_hours.end || '')) {
      errors.push('Quiet hours must be HH:MM (24h)');
    }
  }
  return errors;
}

export const STATE_LABELS = {
  NORMAL: 'Normal',
  TRIGGERED: 'Triggered',
  CRITICAL: 'Critical',
};

export const NOTIFICATION_REASON_LABELS = {
  INITIAL_TRIGGER: 'Initial trigger',
  REMINDER: 'Reminder',
  ESCALATION: 'Escalation',
  DE_ESCALATION: 'Improved',
  RECOVERY: 'Recovery',
};

export const SUPPRESSION_LABELS = {
  cooldown: 'Cooldown active',
  quiet_hours: 'Quiet hours',
};

export const DELIVERY_LABELS = {
  none: 'No notification',
  suppressed: 'Suppressed',
  pending: 'Pending',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  uncertain: 'Uncertain',
};
