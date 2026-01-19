async function BranchNode(def, context) {
  const { metrics } = context;
  const { rules = [], default: defaultRule } = def;

  if (!metrics) {
    return {
      status: 'fail',
      reason: 'BranchNode: context.metrics is missing'
    };
  }

  for (const rule of rules) {
    const conditions = rule.all || [];
    let matched = true;

    for (const condition of conditions) {
      const { metric, op, value } = condition;

      if (!(metric in metrics)) {
        return {
          status: 'fail',
          reason: `BranchNode: Metric "${metric}" not found in context.metrics`
        };
      }

      const metricValue = metrics[metric];

      if (!evaluate(metricValue, op, value)) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return {
        status: 'pass',
        next: rule.then
      };
    }
  }

  // --- default path ---
  if (!defaultRule || !defaultRule.then) {
    return {
      status: 'fail',
      reason: 'BranchNode: No rule matched and no default path defined'
    };
  }

  return {
    status: 'pass',
    next: defaultRule.then
  };
}

module.exports = BranchNode;

function evaluate(left, op, right) {
  switch (op) {
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    default:
      return false;
  }
}
