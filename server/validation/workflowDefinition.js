const ALLOWED_NODE_TYPES = new Set([
  'validation',
  'metric_compare',
  'branch',
  'recursive_dimension_breakdown',
  'composite',
  'insight'
]);

const ALLOWED_DIMENSIONS = new Set([
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

function validateWorkflowDefinition(definition) {
  const errors = [];

  if (!definition || typeof definition !== 'object') {
    return { ok: false, errors: ['definition must be an object'] };
  }

  ['workflow_id', 'workflow_type', 'version', 'nodes'].forEach(field => {
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
          const conditions = rule.all || [];
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
    }

    if (node.type === 'composite') {
      if (!Array.isArray(node.steps) || node.steps.length === 0) {
        errors.push(`composite node ${node.id} must include steps`);
      }
    }

    if (node.type === 'insight') {
      if (!node.template || typeof node.template !== 'object') {
        errors.push(`insight node ${node.id} must include template`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { validateWorkflowDefinition };
