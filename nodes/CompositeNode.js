const mergeContext = require('../engine/MergeContext');
const validationNode = require('./ValidationNode');
const metricCompareNode = require('./MetricCompareNode');
const recursiveDimensionBreakdownNode = require('./RecursiveDimensionBreakdownNode');
const branchNode = require('./BranchNode');
const insightNode = require('./InsightNode');
const workflowRefNode = require('./WorkflowRefNode');
const emailNode = require('./EmailNode');
const alertStateNode = require('./AlertStateNode');

// Kept in sync with engine/WorkflowRunner.js's NodeRegistry by
// tests/composite-registry-parity.test.js -- this copy exists because CompositeNode
// controls its own step loop rather than delegating to WorkflowRunner, not because
// the two registries are meant to diverge.
const NodeRegistry = {
  validation: validationNode,
  metric_compare: metricCompareNode,
  recursive_dimension_breakdown: recursiveDimensionBreakdownNode,
  branch: branchNode,
  workflow_ref: workflowRefNode,
  insight: insightNode,
  email: emailNode,
  // alert_state is rejected inside composite.steps at validation time (design §11.2,
  // since this loop never reads a step's own next/routing output regardless of
  // type) -- registered anyway so a hand-edited or pre-existing workflow that
  // bypasses validation fails with a clear node-level reason, not an undefined
  // registry lookup.
  alert_state: alertStateNode
};

async function CompositeNode(def, context, nodeMapOrOptions) {
  const { steps = [], next } = def;
  const nodeMap = nodeMapOrOptions?.nodeMap || nodeMapOrOptions;
  const runtime = nodeMapOrOptions?.runtime;

  if (!Array.isArray(steps) || steps.length === 0) {
    return {
      status: 'fail',
      reason: 'CompositeNode: steps must be a non-empty array'
    };
  }

  const compositeDelta = {
    filters: [],
    metrics: {},
    rootCausePath: [],
    scratch: {}
  };

  for (const stepId of steps) {
    const stepDef = nodeMap[stepId];

    if (!stepDef) {
      return {
        status: 'fail',
        reason: `CompositeNode: step not found: ${stepId}`
      };
    }

    const executor = NodeRegistry[stepDef.type];
    if (!executor) {
      return {
        status: 'fail',
        reason: `CompositeNode: unsupported node type: ${stepDef.type}`
      };
    }

    const NEEDS_RUNTIME = new Set(['workflow_ref', 'email', 'alert_state']);
    const result = NEEDS_RUNTIME.has(stepDef.type)
      ? await executor(stepDef, context, runtime)
      : await executor(stepDef, context);

    if (!result || typeof result !== 'object') {
      return {
        status: 'fail',
        reason: `CompositeNode: invalid result from ${stepId}`
      };
    }

    // --- failure handling ---
    if (result.status === 'terminated') {
      return result;
    }

    if (result.status === 'fail') {
      const onFail = stepDef.on_fail;

      if (onFail?.action === 'terminate') {
        return {
          status: 'fail',
          reason: onFail.reason || result.reason
        };
      }

      return {
        status: 'fail',
        reason: result.reason
      };
    }

    // --- merge into context immediately ---
    if (result.delta) {
      mergeContext(context, result.delta);
      mergeContext(compositeDelta, result.delta);
    }
  }

  return {
    status: 'pass',
    delta: compositeDelta,
    next
  };
}

module.exports = CompositeNode;
