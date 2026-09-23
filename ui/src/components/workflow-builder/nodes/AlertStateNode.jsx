import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Activity } from 'lucide-react';

export const AlertStateNode = ({ data, isConnectable }) => {
  const sources = data.sources || [];
  const enterConditions = data.breach?.enter || [];
  const exitConditions = data.breach?.exit || [];
  const severityTiers = data.severity_tiers || [];
  const criticalBypassEnabled = data.notify_policy?.critical_bypass?.enabled !== false;

  const summarizeCondition = (cond) =>
    cond?.metric ? `${cond.metric} ${cond.op || '<'} ${cond.value ?? '?'}` : null;

  return (
    <div className="w-[300px] bg-white border-2 border-rose-400 rounded-lg shadow-sm">
      <div className="bg-rose-50 px-3 py-2 border-b border-rose-200 rounded-t-lg flex items-center gap-2">
        <Activity className="w-4 h-4 text-rose-600" />
        <span className="text-sm font-medium text-rose-900">{data.id}</span>
      </div>

      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />

      <div className="p-3 text-xs text-gray-600 space-y-2">
        <div>
          <span className="font-semibold text-gray-700">Sources: </span>
          {sources.length ? (
            <span className="font-mono">{sources.map((s) => s.output_key || '?').join(', ')}</span>
          ) : (
            <span className="italic text-amber-600">none configured</span>
          )}
        </div>

        <div>
          <span className="font-semibold text-gray-700">Enter: </span>
          {enterConditions.length ? (
            <span className="font-mono">{summarizeCondition(enterConditions[0])}{enterConditions.length > 1 ? ` (+${enterConditions.length - 1})` : ''}</span>
          ) : (
            <span className="italic text-amber-600">none</span>
          )}
        </div>
        <div>
          <span className="font-semibold text-gray-700">Exit: </span>
          {exitConditions.length ? (
            <span className="font-mono">{summarizeCondition(exitConditions[0])}{exitConditions.length > 1 ? ` (+${exitConditions.length - 1})` : ''}</span>
          ) : (
            <span className="italic text-amber-600">none</span>
          )}
        </div>

        {severityTiers.length > 0 && (
          <div>
            <span className="font-semibold text-gray-700">Tiers: </span>
            {severityTiers.map((t) => t.name || '?').join(' → ')}
          </div>
        )}

        {!criticalBypassEnabled && (
          <div className="text-amber-700">Critical bypass disabled</div>
        )}
      </div>

      <div className="border-t border-rose-100 p-2 space-y-1">
        <div className="relative flex items-center justify-end bg-rose-50 p-1.5 rounded text-[11px] border border-rose-100">
          <span className="mr-4 text-rose-700 font-medium">Changed</span>
          <Handle
            type="source"
            position={Position.Right}
            id="handle-then"
            isConnectable={isConnectable}
            className="!bg-rose-500"
            style={{ right: '-8px' }}
          />
        </div>
        <div className="relative flex items-center justify-end bg-gray-50 p-1.5 rounded text-[11px] border border-gray-100">
          <span className="mr-4 text-gray-500 italic">No changes</span>
          <Handle
            type="source"
            position={Position.Right}
            id="handle-then-no-changes"
            isConnectable={isConnectable}
            className="!bg-gray-400"
            style={{ right: '-8px' }}
          />
        </div>
      </div>
    </div>
  );
};
