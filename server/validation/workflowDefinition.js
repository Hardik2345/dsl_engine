const ALLOWED_NODE_TYPES = new Set([
  'validation',
  'metric_compare',
  'branch',
  'recursive_dimension_breakdown',
  'composite',
  'workflow_ref',
  'insight'
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
  getPartialDayProductCompatibilityErrors
} = require('./productPartialDayCompatibility');
const { validateRecipients } = require('../services/emailService');

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
          const allConditions = rule.all || [];
          const anyConditions = rule.any || [];
          const conditions = [...allConditions, ...anyConditions];
          
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
    }

    if (node.type === 'composite') {
      if (!Array.isArray(node.steps) || node.steps.length === 0) {
        errors.push(`composite node ${node.id} must include steps`);
      }
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
        node.output_key !== undefined &&
        (typeof node.output_key !== 'string' || node.output_key.trim() === '')
      ) {
        errors.push(`insight node ${node.id} has invalid output_key`);
      }
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
  }

  errors.push(...getPartialDayProductCompatibilityErrors(definition));

  return { ok: errors.length === 0, errors };
}

module.exports = { validateWorkflowDefinition };
