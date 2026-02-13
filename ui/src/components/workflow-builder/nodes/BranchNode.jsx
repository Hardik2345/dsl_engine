import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { GitFork } from 'lucide-react';

// Generate a stable rule ID if missing (for backward compatibility)
const ensureRuleId = (rule, idx) => rule._ruleId || `legacy_rule_${idx}`;

export const BranchNode = ({ data, isConnectable }) => {
  const rules = data.rules || [];

  return (
    <div className="w-[300px] bg-white border-2 border-purple-400 rounded-lg shadow-sm">
      <div className="bg-purple-50 px-3 py-2 border-b border-purple-200 rounded-t-lg flex items-center gap-2">
        <GitFork className="w-4 h-4 text-purple-600" />
        <span className="text-sm font-medium text-purple-900">{data.id}</span>
      </div>

      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />

      <div className="p-2 space-y-2">
        {/* Render Handles for Rules */}
        {rules.map((rule, idx) => {
            const ruleId = ensureRuleId(rule, idx);
            const isBreakdownsRule = !!rule.any_in_breakdowns;
            const firstCondition = isBreakdownsRule
              ? rule.any_in_breakdowns?.conditions?.[0]
              : rule.all?.[0] || rule.any?.[0];
            const isOr = !isBreakdownsRule && rule.any && rule.any.length > 0;
            
            return (
              <div key={ruleId} className="relative flex items-center justify-end bg-purple-50 p-2 rounded text-xs border border-purple-100">
                <span className="mr-4 text-purple-800 font-mono flex items-center gap-1">
                  <span className="font-bold mr-1">
                    {isBreakdownsRule ? 'ANY' : (isOr ? 'OR' : 'AND')}
                  </span>
                  {firstCondition ? (
                      <>
                        {firstCondition.metric} {firstCondition.op} {firstCondition.value}
                        {isBreakdownsRule && rule.any_in_breakdowns?.dimension && (
                          <span className="text-[10px] text-purple-400 ml-1">
                            in {rule.any_in_breakdowns.dimension}
                          </span>
                        )}
                        {!isBreakdownsRule && (rule.all?.length > 1 || rule.any?.length > 1) && (
                          <span className="text-[10px] text-purple-400 ml-1">
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
