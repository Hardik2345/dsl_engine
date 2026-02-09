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
    const allConditions = rule.all || [];
    let allMatched = true;

    for (const condition of allConditions) {
      if (!checkCondition(condition, metrics)) {
        allMatched = false;
        break;
      }
    }

    const anyConditions = rule.any || [];
    let anyMatched = false;
    
    if (anyConditions.length > 0) {
      for (const condition of anyConditions) {
        if (checkCondition(condition, metrics)) {
          anyMatched = true;
          break;
        }
      }
    } else {
      anyMatched = true; 
    }

    if (allConditions.length === 0 && anyConditions.length === 0) {
        allMatched = true;
    }

    const finalMatch = (allConditions.length > 0 ? allMatched : true) && 
                       (anyConditions.length > 0 ? anyMatched : true);

    if (finalMatch) {
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

function checkCondition(condition, metrics) {
    const { metric, op, value } = condition;
    if (!(metric in metrics)) {
        return false;
    }
    const metricValue = metrics[metric];
    return evaluate(metricValue, op, value);
}

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
