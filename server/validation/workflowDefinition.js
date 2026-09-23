const ALLOWED_NODE_TYPES = new Set([
  'validation',
  'metric_compare',
  'branch',
  'recursive_dimension_breakdown',
  'composite',
  'workflow_ref',
  'insight',
  'email',
  'alert_state'
]);

const ALLOWED_DIMENSIONS = new Set([
  "product_id",
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'landing_page_path',
  'landing_page_type',
  'referrer_name'
]);

const ALLOWED_OPS = new Set(['>', '>=', '<', '<=', '==', '!=']);
const {
  getPartialDayProductCompatibilityErrors,
  getPartialDayLandingPagePathCompatibilityErrors
} = require('./productPartialDayCompatibility');
const { validateRecipients } = require('../services/emailService');
const { isSafeBindingPath } = require('../lib/emailBindings');
const { validateEmailBranding } = require('../lib/emailBranding');

const EMAIL_FORMATS = new Set(['insight', 'report', 'finding']);
const NOTIFY_POLICY_FIELDS = new Set([
  'delivery', 'on', 'min_interval', 'reminder_after', 'significance', 'recurrence_window',
  'flap', 'burst_cap', 'rate_cap', 'quiet_hours', 'digest', 'stale_after',
  'respect_upstream_cooldown', 'critical_bypass', 'severity_tier_order'
]);
const FLAP_FIELDS = new Set(['window_ms', 'max_episodes']);
const STATE_SCOPE_FIELDS = new Set(['mode', 'group', 'include_window_mode', 'alertType']);
const STATE_SCOPE_MODES = new Set(['workflow', 'group', 'tenant_alert_type']);
const REPORT_PRESETS = new Set(['performance_report_v1']);
const REPORT_VALUE_FORMATS = new Set(['text', 'integer', 'decimal', 'percent_ratio', 'percent', 'delta_percent']);
const REPORT_TONES = new Set(['positive', 'negative', 'neutral']);
const REPORT_ICONS = new Set(['metric', 'sessions', 'orders', 'conversion', 'trend']);

function validateBindingPath(value, label, errors) {
  if (!isSafeBindingPath(value)) errors.push(`${label} must be a safe dot-separated context path`);
}

function validateBindingTemplate(value, label, errors) {
  if (typeof value !== 'string') return;
  let remainder = value;
  const tokens = value.matchAll(/\{\{([^{}]+)\}\}/g);
  for (const token of tokens) {
    if (!isSafeBindingPath(token[1].trim())) {
      errors.push(`${label} contains an unsafe binding`);
    }
    remainder = remainder.replace(token[0], '');
  }
  if (/[{}]/.test(remainder)) {
    errors.push(`${label} contains malformed binding syntax`);
  }
}

function rejectUnknownFields(value, allowedFields, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  Object.keys(value).filter((key) => !allowedFields.has(key)).forEach((key) => {
    errors.push(`${label} contains unsupported field ${key}`);
  });
}

// design doc §9.2. Kept intentionally shallow (unknown-field rejection plus basic
// type checks) matching the existing branding-validation style -- deep validation of
// each sub-object's internal shape is left to the notifier/pipeline, which already
// has its own defaulting for every field here.
function validateNotifyPolicy(value, label, errors) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  rejectUnknownFields(value, NOTIFY_POLICY_FIELDS, label, errors);
  if (value.critical_bypass !== undefined) {
    if (!value.critical_bypass || typeof value.critical_bypass !== 'object' || Array.isArray(value.critical_bypass)) {
      errors.push(`${label}.critical_bypass must be an object`);
    } else if (value.critical_bypass.enabled !== undefined && typeof value.critical_bypass.enabled !== 'boolean') {
      errors.push(`${label}.critical_bypass.enabled must be boolean`);
    }
  }
  // Phase 4: flap.window_ms/max_episodes and stale_after were already accepted
  // keys (server/lib/alertTransition.js and notificationService.js consume them)
  // but never structurally validated until now.
  if (value.flap !== undefined) {
    if (!value.flap || typeof value.flap !== 'object' || Array.isArray(value.flap)) {
      errors.push(`${label}.flap must be an object`);
    } else {
      rejectUnknownFields(value.flap, FLAP_FIELDS, `${label}.flap`, errors);
      if (value.flap.window_ms !== undefined && !(Number.isFinite(value.flap.window_ms) && value.flap.window_ms > 0)) {
        errors.push(`${label}.flap.window_ms must be a positive number`);
      }
      if (value.flap.max_episodes !== undefined && !(Number.isInteger(value.flap.max_episodes) && value.flap.max_episodes > 0)) {
        errors.push(`${label}.flap.max_episodes must be a positive integer`);
      }
    }
  }
  if (value.stale_after !== undefined && !(Number.isFinite(value.stale_after) && value.stale_after > 0)) {
    errors.push(`${label}.stale_after must be a positive number of milliseconds`);
  }
  if (value.severity_tier_order !== undefined) {
    if (!Array.isArray(value.severity_tier_order) || value.severity_tier_order.some((tier) => typeof tier !== 'string' || !tier.trim())) {
      errors.push(`${label}.severity_tier_order must be an array of non-empty strings`);
    }
  }
}

function validateStateScope(value, label, errors) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  rejectUnknownFields(value, STATE_SCOPE_FIELDS, label, errors);
  if (value.mode !== undefined && !STATE_SCOPE_MODES.has(value.mode)) {
    errors.push(`${label}.mode must be one of workflow|group|tenant_alert_type`);
  }
  if (value.mode === 'group' && (typeof value.group !== 'string' || value.group.trim() === '')) {
    errors.push(`${label} requires group when mode is group`);
  }
}

function validateAlertStateNode(node, errors) {
  const prefix = `alert_state node ${node.id}`;

  if (!Array.isArray(node.sources) || node.sources.length === 0) {
    errors.push(`${prefix} must include a non-empty sources array`);
  } else {
    node.sources.forEach((source, index) => {
      const label = `${prefix} source ${index + 1}`;
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        errors.push(`${label} must be an object`);
        return;
      }
      if (typeof source.output_key !== 'string' || source.output_key.trim() === '') {
        errors.push(`${label} requires output_key`);
      }
      if (source.direction !== undefined && !['drop', 'increase'].includes(source.direction)) {
        errors.push(`${label} direction must be drop or increase`);
      }
    });
  }

  validateStateScope(node.state_scope, `${prefix} state_scope`, errors);

  if (!node.breach || typeof node.breach !== 'object' || Array.isArray(node.breach)) {
    errors.push(`${prefix} must include a breach object`);
  } else {
    ['enter', 'exit'].forEach((key) => {
      const conditions = node.breach[key];
      if (!Array.isArray(conditions) || conditions.length === 0) {
        errors.push(`${prefix} breach.${key} must be a non-empty array`);
        return;
      }
      conditions.forEach((condition) => {
        if (!condition || !ALLOWED_OPS.has(condition.op)) {
          errors.push(`${prefix} breach.${key} has invalid op ${condition?.op}`);
        }
        if (!condition || typeof condition.metric !== 'string' || condition.metric.trim() === '') {
          errors.push(`${prefix} breach.${key} condition requires metric`);
        }
      });
    });
  }

  if (node.severity_tiers !== undefined) {
    if (!Array.isArray(node.severity_tiers)) {
      errors.push(`${prefix} severity_tiers must be an array`);
    } else {
      node.severity_tiers.forEach((tier, index) => {
        const label = `${prefix} severity_tiers ${index + 1}`;
        if (!tier || typeof tier.name !== 'string' || tier.name.trim() === '') {
          errors.push(`${label} requires name`);
        }
        if (!Array.isArray(tier?.when) || tier.when.length === 0) {
          errors.push(`${label} requires a non-empty when array`);
        }
      });
    }
  }

  validateNotifyPolicy(node.notify_policy, `${prefix} notify_policy`, errors);

  if (node.emit_to !== undefined && !Array.isArray(node.emit_to)) {
    errors.push(`${prefix} emit_to must be an array of node ids`);
  }
}

function validateEmailNode(node, errors) {
  const prefix = `email node ${node.id}`;
  if (!EMAIL_FORMATS.has(node.format)) errors.push(`${prefix} format must be insight, report or finding`);
  if (typeof node.subject !== 'string' || node.subject.trim() === '') errors.push(`${prefix} subject is required`);
  validateBindingTemplate(node.subject, `${prefix} subject`, errors);
  const recipients = validateRecipients(node.to);
  if (!recipients.ok) errors.push(`${prefix} recipients invalid: ${recipients.error}`);
  errors.push(...validateEmailBranding(node.branding, `${prefix} branding`));
  validateNotifyPolicy(node.notify_policy, `${prefix} notify_policy`, errors);

  if (node.format === 'finding') {
    if (typeof node.for_each !== 'string' || node.for_each.trim() === '') {
      errors.push(`${prefix} format finding requires for_each`);
    }
    return;
  }
  if (node.for_each !== undefined) {
    validateBindingPath(node.for_each, `${prefix} for_each`, errors);
  }

  if (!node.template || typeof node.template !== 'object' || Array.isArray(node.template)) {
    errors.push(`${prefix} template must be an object`);
    return;
  }
  if (node.format === 'insight') {
    validateBindingPath(node.template.insightSource || 'scratch.finalInsight', `${prefix} template.insightSource`, errors);
    const unsupported = Object.keys(node.template).filter((key) => key !== 'insightSource');
    unsupported.forEach((key) => errors.push(`${prefix} insight template contains unsupported field ${key}`));
    return;
  }
  if (node.format !== 'report') return;

  if (!REPORT_PRESETS.has(node.template.preset)) errors.push(`${prefix} has unsupported report preset`);
  ['eyebrow', 'title'].forEach((field) => {
    if (typeof node.template[field] !== 'string' || node.template[field].trim() === '') {
      errors.push(`${prefix} template.${field} is required`);
    }
  });
  if (node.template.description !== undefined && typeof node.template.description !== 'string') {
    errors.push(`${prefix} template.description must be a string`);
  }
  if (!node.template.period || typeof node.template.period !== 'object' || Array.isArray(node.template.period)) {
    errors.push(`${prefix} template.period must be an object`);
  }
  rejectUnknownFields(node.template.period, new Set(['current', 'comparison']), `${prefix} template.period`, errors);
  validateBindingPath(node.template.period?.current, `${prefix} template.period.current`, errors);
  validateBindingPath(node.template.period?.comparison, `${prefix} template.period.comparison`, errors);

  if (!Array.isArray(node.template.metrics) || node.template.metrics.length < 1 || node.template.metrics.length > 4) {
    errors.push(`${prefix} template.metrics must contain one to four items`);
  } else {
    node.template.metrics.forEach((metric, index) => {
      const label = `${prefix} metric ${index + 1}`;
      if (!metric || typeof metric !== 'object' || Array.isArray(metric)) {
        errors.push(`${label} must be an object`);
        return;
      }
      if (typeof metric.label !== 'string' || metric.label.trim() === '') errors.push(`${label} label is required`);
      validateBindingPath(metric.value, `${label} value`, errors);
      if (metric.change !== undefined) validateBindingPath(metric.change, `${label} change`, errors);
      if (!REPORT_VALUE_FORMATS.has(metric.format)) errors.push(`${label} has unsupported format`);
      if (metric.icon !== undefined && !REPORT_ICONS.has(metric.icon)) errors.push(`${label} has unsupported icon`);
      rejectUnknownFields(metric, new Set(['label', 'value', 'change', 'format', 'icon']), label, errors);
    });
  }

  if (!Array.isArray(node.template.tables) || node.template.tables.length < 1 || node.template.tables.length > 4) {
    errors.push(`${prefix} template.tables must contain one to four tables`);
  } else {
    node.template.tables.forEach((table, tableIndex) => {
      const label = `${prefix} table ${tableIndex + 1}`;
      if (!table || typeof table !== 'object' || Array.isArray(table)) {
        errors.push(`${label} must be an object`);
        return;
      }
      if (typeof table.title !== 'string' || table.title.trim() === '') errors.push(`${label} title is required`);
      validateBindingPath(table.source, `${label} source`, errors);
      if (!REPORT_TONES.has(table.tone || 'neutral')) errors.push(`${label} has unsupported tone`);
      if (!Number.isInteger(table.limit) || table.limit < 1 || table.limit > 100) errors.push(`${label} limit must be an integer from 1 to 100`);
      if (!Array.isArray(table.columns) || table.columns.length < 1) {
        errors.push(`${label} must contain at least one column`);
      } else {
        table.columns.forEach((column, columnIndex) => {
          const columnLabel = `${label} column ${columnIndex + 1}`;
          if (!column || typeof column !== 'object' || Array.isArray(column)) {
            errors.push(`${columnLabel} must be an object`);
            return;
          }
          if (typeof column.label !== 'string' || column.label.trim() === '') errors.push(`${columnLabel} label is required`);
          validateBindingPath(column.path, `${columnLabel} path`, errors);
          if (!REPORT_VALUE_FORMATS.has(column.format)) errors.push(`${columnLabel} has unsupported format`);
          rejectUnknownFields(column, new Set(['label', 'path', 'format']), columnLabel, errors);
        });
      }
      rejectUnknownFields(table, new Set(['title', 'source', 'tone', 'limit', 'columns']), label, errors);
    });
  }
  const allowed = new Set(['preset', 'eyebrow', 'title', 'description', 'period', 'metrics', 'tables']);
  Object.keys(node.template).filter((key) => !allowed.has(key)).forEach((key) => {
    errors.push(`${prefix} report template contains unsupported field ${key}`);
  });
}

function validateInsightDetailItem(detail, nodeId, errors, index) {
  if (typeof detail === 'string') {
    return;
  }

  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
    errors.push(`insight node ${nodeId} detail ${index + 1} must be a string or object`);
    return;
  }

  if (typeof detail.title !== 'string' || detail.title.trim() === '') {
    errors.push(`insight node ${nodeId} detail ${index + 1} must include a non-empty title`);
  }

  if (detail.items !== undefined && !Array.isArray(detail.items)) {
    errors.push(`insight node ${nodeId} detail ${index + 1} items must be an array when provided`);
    return;
  }

  (detail.items || []).forEach((item, itemIndex) => {
    if (typeof item !== 'string' || item.trim() === '') {
      errors.push(`insight node ${nodeId} detail ${index + 1} item ${itemIndex + 1} must be a non-empty string`);
    }
  });
}

function validateWorkflowDefinition(definition) {
  const errors = [];

  if (!definition || typeof definition !== 'object') {
    return { ok: false, errors: ['definition must be an object'] };
  }

  // workflow_id is optional (auto-generated if not provided)
  ['workflow_type', 'version', 'nodes', 'trigger'].forEach(field => {
    if (!definition[field]) {
      errors.push(`missing ${field}`);
    }
  });

  if (definition.workflow_type && definition.workflow_type !== 'root_cause_analysis') {
    errors.push('workflow_type must be root_cause_analysis');
  }

  // "Send Daily Insight" toggle: marks a workflow as a plain scheduled report
  // rather than a condition-based alert. Read by workflowExecutionService.js to
  // skip the finding/state-machine treatment entirely for its runs, and by
  // emailService.js to skip the 24h content cooldown -- a report must go out
  // every scheduled run even if the numbers happen to repeat, e.g. a quiet
  // weekend with zero orders two days running.
  if (definition.always_send !== undefined && typeof definition.always_send !== 'boolean') {
    errors.push('always_send must be boolean');
  }

  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
    errors.push('nodes must be a non-empty array');
    return { ok: false, errors };
  }

  if (!definition.trigger || typeof definition.trigger !== 'object') {
    errors.push('trigger must be an object');
  } else {
    const { alertType, brandScope, brandIds, type } = definition.trigger;
    if (type && type !== 'alert') {
      errors.push('trigger.type must be alert');
    }
    if (!alertType || typeof alertType !== 'string') {
      errors.push('trigger.alertType is required');
    }
    if (!brandScope || !['single', 'multiple', 'global'].includes(brandScope)) {
      errors.push('trigger.brandScope must be one of single|multiple|global');
    }
    if ((brandScope === 'single' || brandScope === 'multiple')
      && (!Array.isArray(brandIds) || brandIds.length === 0)) {
      errors.push('trigger.brandIds is required for single/multiple brandScope');
    }
    if (brandScope === 'global' && Array.isArray(brandIds) && brandIds.length) {
      errors.push('trigger.brandIds must be empty for global brandScope');
    }
  }

  const nodeIds = new Set();
  const nodeTypeById = new Map();
  for (const node of definition.nodes) {
    if (!node?.id || typeof node.id !== 'string') {
      errors.push('each node must have an id');
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push(`duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);

    if (!node.type || !ALLOWED_NODE_TYPES.has(node.type)) {
      errors.push(`unsupported node type: ${node.type}`);
      continue;
    }
    nodeTypeById.set(node.id, node.type);

    if (node.type === 'validation') {
      if (!Array.isArray(node.checks) || node.checks.length === 0) {
        errors.push(`validation node ${node.id} must include checks`);
      }
    }

    if (node.type === 'metric_compare') {
      if (!Array.isArray(node.metrics) || node.metrics.length === 0) {
        errors.push(`metric_compare node ${node.id} must include metrics`);
      }
    }

    if (node.type === 'branch') {
      if (!Array.isArray(node.rules) || node.rules.length === 0) {
        errors.push(`branch node ${node.id} must include rules`);
      } else {
        for (const rule of node.rules) {
          const breakdownRuleDefinitions = [
            rule.any_in_breakdowns,
            rule.all_in_breakdowns,
            rule.filter_in_breakdowns
          ].filter(Boolean);
          if (breakdownRuleDefinitions.length > 1) {
            errors.push(`branch node ${node.id} rule ${rule._ruleId || ''} cannot define more than one breakdown rule type`);
          }

          const breakdownRule = rule.any_in_breakdowns || rule.all_in_breakdowns || rule.filter_in_breakdowns;
          if (breakdownRule) {
            if (typeof breakdownRule.dimension !== 'string' || breakdownRule.dimension.trim() === '') {
              errors.push(`branch node ${node.id} has breakdown rule with invalid dimension/output key`);
            }
            if (!Array.isArray(breakdownRule.conditions) || breakdownRule.conditions.length === 0) {
              errors.push(`branch node ${node.id} has breakdown rule without conditions`);
            }
            if (
              breakdownRule.limit !== undefined &&
              (!Number.isFinite(Number(breakdownRule.limit)) || Number(breakdownRule.limit) <= 0)
            ) {
              errors.push(`branch node ${node.id} has breakdown rule with invalid limit`);
            }
            if (
              (rule.any_in_breakdowns || rule.all_in_breakdowns)?.entry_logic !== undefined &&
              !['and', 'or'].includes((rule.any_in_breakdowns || rule.all_in_breakdowns).entry_logic)
            ) {
              errors.push(`branch node ${node.id} has breakdown rule with invalid entry_logic`);
            }
            if (
              rule.filter_in_breakdowns &&
              !['any', 'all'].includes(rule.filter_in_breakdowns.mode || 'any')
            ) {
              errors.push(`branch node ${node.id} has breakdown filter rule with invalid mode`);
            }
            if (
              rule.filter_in_breakdowns?.entry_logic !== undefined &&
              !['and', 'or'].includes(rule.filter_in_breakdowns.entry_logic)
            ) {
              errors.push(`branch node ${node.id} has breakdown filter rule with invalid entry_logic`);
            }
            if (
              rule.filter_in_breakdowns?.match_scope !== undefined &&
              !['any', 'all'].includes(rule.filter_in_breakdowns.match_scope)
            ) {
              errors.push(`branch node ${node.id} has breakdown filter rule with invalid match_scope`);
            }
            if (
              rule.filter_in_breakdowns &&
              (typeof rule.filter_in_breakdowns.write_matches_to !== 'string'
                || rule.filter_in_breakdowns.write_matches_to.trim() === '')
            ) {
              errors.push(`branch node ${node.id} has breakdown filter rule without write_matches_to`);
            }
          }

          const allConditions = rule.all || [];
          const anyConditions = rule.any || [];
          const breakdownConditions = Array.isArray(breakdownRule?.conditions) ? breakdownRule.conditions : [];
          const conditions = [...allConditions, ...anyConditions, ...breakdownConditions];
          
          for (const condition of conditions) {
            if (!ALLOWED_OPS.has(condition.op)) {
              errors.push(`branch node ${node.id} has invalid op ${condition.op}`);
            }
          }
        }
      }
    }

    if (node.type === 'recursive_dimension_breakdown') {
      const dimensions = Array.isArray(node.dimensions) && node.dimensions.length
        ? node.dimensions
        : node.dimension
          ? [node.dimension]
          : [];

      if (!dimensions.length) {
        errors.push(`recursive_dimension_breakdown node ${node.id} must include dimension(s)`);
      }

      for (const dim of dimensions) {
        if (!ALLOWED_DIMENSIONS.has(dim)) {
          errors.push(`unsupported dimension: ${dim}`);
        }
      }

      if (
        node.output_key !== undefined &&
        (typeof node.output_key !== 'string' || node.output_key.trim() === '')
      ) {
        errors.push(`recursive_dimension_breakdown node ${node.id} has invalid output_key`);
      }

      if (
        node.input_scope !== undefined &&
        !['global', 'breakdown'].includes(node.input_scope)
      ) {
        errors.push(`recursive_dimension_breakdown node ${node.id} has invalid input_scope`);
      }

      if (
        node.input_scope === 'breakdown' &&
        (typeof node.input_key !== 'string' || node.input_key.trim() === '')
      ) {
        errors.push(`recursive_dimension_breakdown node ${node.id} requires input_key when input_scope is breakdown`);
      }

      if (
        node.input_key !== undefined &&
        (typeof node.input_key !== 'string' || node.input_key.trim() === '')
      ) {
        errors.push(`recursive_dimension_breakdown node ${node.id} has invalid input_key`);
      }

      if (
        typeof node.output_key === 'string' &&
        typeof node.input_key === 'string' &&
        node.output_key.trim() &&
        node.input_key.trim() &&
        node.output_key.trim() === node.input_key.trim()
      ) {
        errors.push(`recursive_dimension_breakdown node ${node.id} cannot use the same input_key and output_key`);
      }
    }

    if (node.type === 'composite') {
      if (!Array.isArray(node.steps) || node.steps.length === 0) {
        errors.push(`composite node ${node.id} must include steps`);
      }
    }

    if (node.type === 'alert_state') {
      validateAlertStateNode(node, errors);
    }

    if (node.type === 'workflow_ref') {
      if (!node.ref || typeof node.ref !== 'object') {
        errors.push(`workflow_ref node ${node.id} must include ref`);
      } else {
        if (!node.ref.workflow_id || typeof node.ref.workflow_id !== 'string') {
          errors.push(`workflow_ref node ${node.id} must include ref.workflow_id`);
        }
        if (!node.ref.version || typeof node.ref.version !== 'string') {
          errors.push(`workflow_ref node ${node.id} must include ref.version`);
        }
        if (
          node.ref.scope !== undefined &&
          !['tenant', 'global'].includes(node.ref.scope)
        ) {
          errors.push(`workflow_ref node ${node.id} has invalid ref.scope`);
        }
      }
    }

    if (node.type === 'insight') {
      if (!node.template || (typeof node.template !== 'object' && typeof node.template !== 'string')) {
        errors.push(`insight node ${node.id} must include template`);
      }
      if (
        node.template
        && typeof node.template === 'object'
        && node.template !== null
        && node.template.details !== undefined
      ) {
        if (!Array.isArray(node.template.details)) {
          errors.push(`insight node ${node.id} template.details must be an array when provided`);
        } else {
          node.template.details.forEach((detail, index) => validateInsightDetailItem(detail, node.id, errors, index));
        }
      }
      if (
        node.output_key !== undefined &&
        (typeof node.output_key !== 'string' || node.output_key.trim() === '')
      ) {
        errors.push(`insight node ${node.id} has invalid output_key`);
      }
      validateNotifyPolicy(node.notify_policy, `insight node ${node.id} notify_policy`, errors);
      if (node.email !== undefined) {
        if (!node.email || typeof node.email !== 'object' || Array.isArray(node.email)) {
          errors.push(`insight node ${node.id} email must be an object`);
        } else {
          if (
            node.email.enabled !== undefined &&
            typeof node.email.enabled !== 'boolean'
          ) {
            errors.push(`insight node ${node.id} email.enabled must be boolean`);
          }
          if (
            node.email.subject !== undefined &&
            (typeof node.email.subject !== 'string' || node.email.subject.trim() === '')
          ) {
            errors.push(`insight node ${node.id} email.subject must be a non-empty string when provided`);
          }
          if (node.email.to !== undefined && !Array.isArray(node.email.to)) {
            errors.push(`insight node ${node.id} email.to must be an array`);
          }
          if (node.email.enabled) {
            const recipientValidation = validateRecipients(node.email.to);
            if (!recipientValidation.ok) {
              errors.push(`insight node ${node.id} email config invalid: ${recipientValidation.error}`);
            }
          }
        }
      }
    }

    if (node.type === 'email') {
      validateEmailNode(node, errors);
    }
  }

  // design §11.2: CompositeNode never reads a step's own `next`/routing output
  // regardless of node type, so an alert_state step could compute transitions but
  // could never route via then/then_no_changes. Flatly rejected rather than allowed
  // to silently no-op.
  for (const node of definition.nodes) {
    if (node.type !== 'composite' || !Array.isArray(node.steps)) continue;
    node.steps.forEach((stepId) => {
      if (nodeTypeById.get(stepId) === 'alert_state') {
        errors.push(`composite node ${node.id} cannot include alert_state step ${stepId}: its transitions could never route via then/then_no_changes inside a composite`);
      }
    });
  }

  errors.push(...getPartialDayProductCompatibilityErrors(definition));
  errors.push(...getPartialDayLandingPagePathCompatibilityErrors(definition));

  return { ok: errors.length === 0, errors };
}

module.exports = { validateWorkflowDefinition };
