// Workflow state engine (docs/workflow-state-engine.md). Shared constants, default
// config/state, and the small predicates every other stateEngine module keys off.

const STATES = Object.freeze({
  NORMAL: 'NORMAL',
  TRIGGERED: 'TRIGGERED',
  CRITICAL: 'CRITICAL'
});

const REASONS = Object.freeze({
  INITIAL_TRIGGER: 'INITIAL_TRIGGER',
  REMINDER: 'REMINDER',
  ESCALATION: 'ESCALATION',
  DE_ESCALATION: 'DE_ESCALATION',
  RECOVERY: 'RECOVERY'
});

const WORKFLOW_PURPOSES = Object.freeze({
  RCA: 'rca',
  DAILY_INSIGHT: 'daily_insight'
});

const FINDING_DIRECTIONS = ['drop', 'rise', 'absolute'];

// Only runs the workflow's own schedule/alert wiring produced count as recovery
// evidence -- a person clicking "Run" is not an independent observation of the
// metric's trend.
const AUTOMATIC_TRIGGER_TYPES = new Set(['cron', 'event']);

const MIN_REQUIRED_EVIDENCE = 2;

const DEFAULT_STATE_CONFIG = Object.freeze({
  enabled: false,
  finding: { metric: 'cvr_delta_pct', direction: 'drop' },
  thresholds: { normal: 15, critical: 25 },
  cooldown: { triggered_minutes: 60, critical_minutes: 30 },
  recovery: { required_evidence: MIN_REQUIRED_EVIDENCE },
  quiet_hours: { enabled: false, start: '23:00', end: '07:00' }
});

function getWorkflowPurpose(definition = {}) {
  return definition?.workflow_purpose === WORKFLOW_PURPOSES.DAILY_INSIGHT
    ? WORKFLOW_PURPOSES.DAILY_INSIGHT
    : WORKFLOW_PURPOSES.RCA;
}

// Daily insight/report workflows never go through the state engine, whatever their
// state_config says -- they must send every run, inside quiet hours included.
function isStateEngineEnabled(definition = {}) {
  if (getWorkflowPurpose(definition) === WORKFLOW_PURPOSES.DAILY_INSIGHT) return false;
  return definition?.state_config?.enabled === true;
}

function isAutomaticTrigger(triggerType) {
  return AUTOMATIC_TRIGGER_TYPES.has(triggerType);
}

function normalizeStateConfig(config = {}) {
  const d = DEFAULT_STATE_CONFIG;
  const requiredEvidence = Number(config.recovery?.required_evidence ?? d.recovery.required_evidence);
  return {
    enabled: config.enabled === true,
    finding: {
      metric: config.finding?.metric || d.finding.metric,
      direction: FINDING_DIRECTIONS.includes(config.finding?.direction) ? config.finding.direction : d.finding.direction
    },
    thresholds: {
      normal: Number(config.thresholds?.normal ?? d.thresholds.normal),
      critical: Number(config.thresholds?.critical ?? d.thresholds.critical)
    },
    cooldown: {
      triggered_minutes: Number(config.cooldown?.triggered_minutes ?? d.cooldown.triggered_minutes),
      critical_minutes: Number(config.cooldown?.critical_minutes ?? d.cooldown.critical_minutes)
    },
    recovery: {
      required_evidence: Math.max(MIN_REQUIRED_EVIDENCE, Number.isFinite(requiredEvidence) ? requiredEvidence : MIN_REQUIRED_EVIDENCE)
    },
    quiet_hours: {
      enabled: config.quiet_hours?.enabled === true,
      start: config.quiet_hours?.start || d.quiet_hours.start,
      end: config.quiet_hours?.end || d.quiet_hours.end
    }
  };
}

function defaultRuntimeState() {
  return {
    state: STATES.NORMAL,
    cooldown: null,
    recovery: { pending: false, evidence_count: 0, from_state: null },
    last_evaluated_at: null,
    last_alert_at: null,
    last_execution_id: null,
    version: 0
  };
}

module.exports = {
  STATES,
  REASONS,
  WORKFLOW_PURPOSES,
  FINDING_DIRECTIONS,
  MIN_REQUIRED_EVIDENCE,
  DEFAULT_STATE_CONFIG,
  getWorkflowPurpose,
  isStateEngineEnabled,
  isAutomaticTrigger,
  normalizeStateConfig,
  defaultRuntimeState
};
