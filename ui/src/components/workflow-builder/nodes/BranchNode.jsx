import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { GitFork } from 'lucide-react';

// Generate a stable rule ID if missing (for backward compatibility)
const ensureRuleId = (rule, idx) => rule._ruleId || `legacy_rule_${idx}`;

export const BranchNode = ({ data, isConnectable }) => {
  const rules = data.rules || [];

  return (
    <div className="w-[340px] bg-white border-2 border-purple-400 rounded-lg shadow-sm">
      <div className="bg-purple-50 px-3 py-2 border-b border-purple-200 rounded-t-lg flex items-center gap-2">
        <GitFork className="w-4 h-4 text-purple-600" />
        <span className="text-sm font-medium text-purple-900">{data.id}</span>
      </div>

      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />

      <div className="p-2 space-y-2">
        {/* Render Handles for Rules */}
        {rules.map((rule, idx) => {
            const ruleId = ensureRuleId(rule, idx);
            const breakdownRule = rule.filter_in_breakdowns || rule.any_in_breakdowns || rule.all_in_breakdowns || null;
            const breakdownLabel = rule.filter_in_breakdowns
              ? 'FILTER'
              : rule.all_in_breakdowns
                ? 'ALL'
                : rule.any_in_breakdowns
                  ? 'ANY'
                  : null;
            const isBreakdownsRule = !!breakdownRule;
            const firstCondition = isBreakdownsRule
              ? breakdownRule?.conditions?.[0]
              : rule.all?.[0] || rule.any?.[0];
            const isOr = !isBreakdownsRule && rule.any && rule.any.length > 0;
            
            return (
              <div key={ruleId} className="relative flex items-center justify-end bg-purple-50 p-2 rounded text-xs border border-purple-100 overflow-hidden">
                <span className="mr-4 min-w-0 max-w-[260px] text-purple-800 font-mono flex items-center gap-1 overflow-hidden whitespace-nowrap">
                  <span className="font-bold mr-1 shrink-0">
                    {isBreakdownsRule ? breakdownLabel : (isOr ? 'OR' : 'AND')}
                  </span>
                  {firstCondition ? (
                      <>
                        <span className="truncate">
                          {firstCondition.metric} {firstCondition.op} {firstCondition.value}
                        </span>
                        {isBreakdownsRule && breakdownRule?.dimension && (
                          <span className="text-[10px] text-purple-400 ml-1 shrink-0 truncate max-w-[88px]">
                            in {breakdownRule.dimension}
                          </span>
                        )}
                        {rule.filter_in_breakdowns?.write_matches_to && (
                          <span className="text-[10px] text-purple-400 ml-1 shrink-0 truncate max-w-[88px]">
                            {'->'} {rule.filter_in_breakdowns.write_matches_to}
                          </span>
                        )}
                        {!isBreakdownsRule && (rule.all?.length > 1 || rule.any?.length > 1) && (
                          <span className="text-[10px] text-purple-400 ml-1 shrink-0">
                            (+{ (rule.all?.length || 0) + (rule.any?.length || 0) - 1 })
                          </span>
                        )}
                      </>
                  ) : (
                      <span className="italic text-gray-400">Empty Rule</span>
                  )}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`handle-rule-${ruleId}`}
                  isConnectable={isConnectable}
                  className="!bg-purple-500"
                  style={{ right: '-8px' }}
                />
              </div>
            );
        })}

        {/* Default Path */}
        <div className="relative flex items-center justify-end bg-gray-50 p-2 rounded text-xs border border-gray-100">
          <span className="mr-4 text-gray-600 italic">Default Path</span>
          <Handle
            type="source"
            position={Position.Right}
            id="handle-default"
            isConnectable={isConnectable}
            className="!bg-gray-400"
            style={{ right: '-8px' }}
          />
        </div>
      </div>
    </div>
  );
};
