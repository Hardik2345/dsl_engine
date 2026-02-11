async function BranchNode(def, context) {
  const { metrics, breakdowns } = context;
  const { rules = [], default: defaultRule } = def;

  if (!metrics) {
    return {
      status: 'fail',
      reason: 'BranchNode: context.metrics is missing'
    };
  }

  for (const rule of rules) {
    if (rule.any_in_breakdowns) {
      const matchedEntry = evaluateBreakdownRule(rule.any_in_breakdowns, breakdowns);
      if (matchedEntry) {
        context.scratch = {
          ...(context.scratch || {}),
          matched_breakdown: matchedEntry
        };
      }
      if (matchedEntry) {
        return {
          status: 'pass',
          next: rule.then
        };
      }
      continue;
    }

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

function evaluateBreakdownRule(config, breakdowns = {}) {
  const { dimension, conditions = [], limit } = config || {};
  if (!dimension || !Array.isArray(conditions) || conditions.length === 0) {
    return false;
  }

  const entries = Array.isArray(breakdowns?.[dimension]) ? breakdowns[dimension] : [];
  const pool = typeof limit === 'number' ? entries.slice(0, limit) : entries;

  for (const entry of pool) {
    let allMatched = true;
    for (const condition of conditions) {
      const metricValue = resolveEntryMetric(entry, condition.metric);
      if (!evaluate(metricValue, condition.op, condition.value)) {
        allMatched = false;
        break;
      }
    }

    if (allMatched) {
      return entry;
    }
  }

  return null;
}

function resolveEntryMetric(entry, metric) {
  if (!entry || !metric) return undefined;

  if (entry.deltas && metric in entry.deltas) return entry.deltas[metric];
  if (entry.current && metric in entry.current) return entry.current[metric];
  if (entry.baseline && metric in entry.baseline) return entry.baseline[metric];
  if (metric in entry) return entry[metric];

  return undefined;
}

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
