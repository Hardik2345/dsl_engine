import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  WORKFLOW_PURPOSES,
  MIN_REQUIRED_EVIDENCE,
  STATE_METRIC_OPTIONS,
  STATE_DIRECTION_OPTIONS,
  getWorkflowPurpose,
  withStateConfigDefaults,
} from '../../utils/stateConfig';

const inputClass = 'border border-gray-300 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500';
const numberInputClass = `${inputClass} w-20`;

// Keeps an empty input empty rather than coercing it to 0, so validation can flag it.
const toNumberOrEmpty = (value) => (value === '' ? '' : Number(value));

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
    </label>
  );
}

// Workflow-level settings for the state engine (docs/workflow-state-engine.md):
// whether this is an RCA alert or a daily insight/report, and for RCA workflows the
// thresholds, cooldowns, recovery evidence and quiet hours. Writes straight into the
// builder's metadata, which graphToJson spreads into the saved definition.
export default function AlertStatePanel({ metadata, setMetadata }) {
  const [expanded, setExpanded] = useState(false);
  const purpose = getWorkflowPurpose(metadata);
  const config = withStateConfigDefaults(metadata.state_config);
  const isRca = purpose === WORKFLOW_PURPOSES.RCA;
  const enabled = isRca && config.enabled;

  const setPurpose = (nextPurpose) => {
    setMetadata((m) => ({
      ...m,
      workflow_purpose: nextPurpose,
      // A daily insight must send every run, so it can never keep state enabled.
      ...(nextPurpose === WORKFLOW_PURPOSES.DAILY_INSIGHT && m.state_config
        ? { state_config: { ...m.state_config, enabled: false } }
        : {}),
    }));
  };

  const update = (section, field, value) => {
    setMetadata((m) => {
      const current = withStateConfigDefaults(m.state_config);
      return {
        ...m,
        state_config: section
          ? { ...current, [section]: { ...current[section], [field]: value } }
          : { ...current, [field]: value },
      };
    });
  };

  const direction = STATE_DIRECTION_OPTIONS.find((option) => option.value === config.finding.direction);

  let summary = 'Sends on every run';
  if (isRca) {
    summary = enabled
      ? `Alert at ${config.thresholds.normal}, critical at ${config.thresholds.critical} · ${config.finding.metric}`
      : 'Alert state off: sends on every run';
  }

  return (
    <div className="bg-white border-b border-gray-200 px-4 py-2">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3 text-sm text-gray-700">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Workflow type</span>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="workflow-purpose"
              checked={isRca}
              onChange={() => setPurpose(WORKFLOW_PURPOSES.RCA)}
            />
            RCA alert
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="workflow-purpose"
              checked={!isRca}
              onChange={() => setPurpose(WORKFLOW_PURPOSES.DAILY_INSIGHT)}
            />
            Daily insight / report
          </label>
        </div>

        {isRca ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <span className="font-medium">Alert state</span>
            <span className="text-xs text-gray-500">· {summary}</span>
          </button>
        ) : (
          <span className="text-xs text-gray-500">
            Daily insights ignore alert state, cooldowns and quiet hours and send on every run.
          </span>
        )}
      </div>

      {isRca && expanded && (
        <div className="mt-3 pb-2 space-y-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => update(null, 'enabled', e.target.checked)}
            />
            Use alert state (Normal / Triggered / Critical) to decide when to email
          </label>

          {enabled && (
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              <div className="flex gap-3 items-start">
                <Field label="Metric">
                  <select
                    className={inputClass}
                    value={config.finding.metric}
                    onChange={(e) => update('finding', 'metric', e.target.value)}
                  >
                    {STATE_METRIC_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Direction" hint={direction?.hint}>
                  <select
                    className={inputClass}
                    value={config.finding.direction}
                    onChange={(e) => update('finding', 'direction', e.target.value)}
                  >
                    {STATE_DIRECTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="flex gap-3 items-start">
                <Field label="Alert at (%)" hint="Triggered from this value">
                  <input
                    type="number" min="0" step="any" className={numberInputClass}
                    value={config.thresholds.normal}
                    onChange={(e) => update('thresholds', 'normal', toNumberOrEmpty(e.target.value))}
                  />
                </Field>
                <Field label="Critical at (%)" hint="Critical from this value">
                  <input
                    type="number" min="0" step="any" className={numberInputClass}
                    value={config.thresholds.critical}
                    onChange={(e) => update('thresholds', 'critical', toNumberOrEmpty(e.target.value))}
                  />
                </Field>
              </div>

              <div className="flex gap-3 items-start">
                <Field label="Triggered cooldown (min)">
                  <input
                    type="number" min="0" step="1" className={numberInputClass}
                    value={config.cooldown.triggered_minutes}
                    onChange={(e) => update('cooldown', 'triggered_minutes', toNumberOrEmpty(e.target.value))}
                  />
                </Field>
                <Field label="Critical cooldown (min)">
                  <input
                    type="number" min="0" step="1" className={numberInputClass}
                    value={config.cooldown.critical_minutes}
                    onChange={(e) => update('cooldown', 'critical_minutes', toNumberOrEmpty(e.target.value))}
                  />
                </Field>
              </div>

              <Field label="Recovery after" hint="Consecutive normal scheduled runs. Manual runs don't count.">
                <input
                  type="number" min={MIN_REQUIRED_EVIDENCE} step="1" className={numberInputClass}
                  value={config.recovery.required_evidence}
                  onChange={(e) => update('recovery', 'required_evidence', toNumberOrEmpty(e.target.value))}
                />
              </Field>

              <div className="flex gap-3 items-start">
                <Field label="Quiet hours" hint="Tenant timezone, both ends inclusive">
                  <label className="flex items-center gap-2 text-sm text-gray-700 h-[30px]">
                    <input
                      type="checkbox"
                      checked={config.quiet_hours.enabled}
                      onChange={(e) => update('quiet_hours', 'enabled', e.target.checked)}
                    />
                    Enabled
                  </label>
                </Field>
                {config.quiet_hours.enabled && (
                  <>
                    <Field label="From">
                      <input
                        type="time" className={inputClass}
                        value={config.quiet_hours.start}
                        onChange={(e) => update('quiet_hours', 'start', e.target.value)}
                      />
                    </Field>
                    <Field label="To">
                      <input
                        type="time" className={inputClass}
                        value={config.quiet_hours.end}
                        onChange={(e) => update('quiet_hours', 'end', e.target.value)}
                      />
                    </Field>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
