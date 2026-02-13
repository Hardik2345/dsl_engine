async function BranchNode(def, context) {
  const { metrics, breakdowns } = context;
  const { rules = [], default: defaultRule } = def;

  // Track rule evaluations for debugging
  const ruleEvaluations = [];

  if (!metrics) {
    return {
      status: 'fail',
      reason: 'BranchNode: context.metrics is missing'
    };
  }

  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
    const rule = rules[ruleIndex];
    const ruleEval = { 
      ruleIndex, 
      ruleId: rule._ruleId,
      conditions: [],
      matched: false 
    };

    if (rule.any_in_breakdowns) {
      const matchedEntry = evaluateBreakdownRule(rule.any_in_breakdowns, breakdowns);
      ruleEval.type = 'breakdown';
      ruleEval.matched = !!matchedEntry;
      ruleEvaluations.push(ruleEval);
      
      if (matchedEntry) {
        context.scratch = {
          ...(context.scratch || {}),
          matched_breakdown: matchedEntry
        };
        return {
          status: 'pass',
          next: rule.then,
          ruleEvaluations,
          matchedRule: ruleIndex
        };
      }
      continue;
    }

    const allConditions = rule.all || [];
    let allMatched = true;

    for (const condition of allConditions) {
      const metricValue = metrics[condition.metric];
      const result = checkCondition(condition, metrics);
      ruleEval.conditions.push({
        type: 'all',
        metric: condition.metric,
        op: condition.op,
        expectedValue: condition.value,
        actualValue: metricValue,
        found: condition.metric in metrics,
        passed: result
      });
      if (!result) {
        allMatched = false;
        break;
      }
    }

    const anyConditions = rule.any || [];
    let anyMatched = false;
    
    if (anyConditions.length > 0) {
      for (const condition of anyConditions) {
        const metricValue = metrics[condition.metric];
        const result = checkCondition(condition, metrics);
        ruleEval.conditions.push({
          type: 'any',
          metric: condition.metric,
          op: condition.op,
          expectedValue: condition.value,
          actualValue: metricValue,
          found: condition.metric in metrics,
          passed: result
        });
        if (result) {
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

    ruleEval.matched = finalMatch;
    ruleEvaluations.push(ruleEval);

    if (finalMatch) {
      return {
        status: 'pass',
        next: rule.then,
        ruleEvaluations,
        matchedRule: ruleIndex
      };
    }
  }

  // --- default path ---
  ruleEvaluations.push({ type: 'default', matched: true });
  
  if (!defaultRule || !defaultRule.then) {
    return {
      status: 'fail',
      reason: 'BranchNode: No rule matched and no default path defined',
      ruleEvaluations
    };
  }

  return {
    status: 'pass',
    next: defaultRule.then,
    ruleEvaluations,
    matchedRule: 'default'
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
  // Convert right (from JSON config) to number for numeric comparisons
  const numRight = typeof right === 'string' ? parseFloat(right) : right;
  const numLeft = typeof left === 'number' ? left : parseFloat(left);
  
  // Handle NaN cases
  if (isNaN(numLeft) || isNaN(numRight)) {
    // Fall back to string comparison for non-numeric values
    switch (op) {
      case '==':
        return left == right;
      case '!=':
        return left != right;
      default:
        return false;
    }
  }
  
  switch (op) {
    case '>':
      return numLeft > numRight;
    case '>=':
      return numLeft >= numRight;
    case '<':
      return numLeft < numRight;
    case '<=':
      return numLeft <= numRight;
    case '==':
      return numLeft === numRight;
    case '!=':
      return numLeft !== numRight;
    default:
      return false;
  }
}
