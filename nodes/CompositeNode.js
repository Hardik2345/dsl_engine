const mergeContext = require('../engine/MergeContext');
const validationNode = require('./ValidationNode');
const metricCompareNode = require('./MetricCompareNode');
const recursiveDimensionBreakdownNode = require('./RecursiveDimensionBreakdownNode');
const branchNode = require('./BranchNode');
const insightNode = require('./InsightNode');

const NodeRegistry = {
  validation: validationNode,
  metric_compare: metricCompareNode,
  recursive_dimension_breakdown: recursiveDimensionBreakdownNode,
  branch: branchNode,
  insight: insightNode
};

async function CompositeNode(def, context, nodeMap) {
  const { steps = [], next } = def;

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

    const result = await executor(stepDef, context);

    if (!result || typeof result !== 'object') {
      return {
        status: 'fail',
        reason: `CompositeNode: invalid result from ${stepId}`
      };
    }

    // --- failure handling ---
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
