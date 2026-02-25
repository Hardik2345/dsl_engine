import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Link2 } from 'lucide-react';

export const WorkflowRefNode = ({ data, isConnectable }) => {
  const ref = data?.ref || {};
  const scope = ref.scope || 'tenant';
  const label = data?.referencedWorkflowName || ref.workflow_id || 'Workflow Ref';

  return (
    <div className="w-[280px] bg-white border-2 border-amber-400 rounded-lg shadow-sm">
      <div className="bg-amber-50 px-3 py-2 border-b border-amber-200 rounded-t-lg flex items-center gap-2">
        <Link2 className="w-4 h-4 text-amber-700" />
        <span className="text-sm font-medium text-amber-900 line-clamp-1" title={data?.id}>
          {data?.id}
        </span>
      </div>

      <div className="p-3 text-xs text-gray-700 space-y-2">
        <div className="font-semibold text-amber-800">Workflow Reference</div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-500">Name</span>
            <span className="font-medium text-right truncate" title={label}>{label}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-500">Workflow ID</span>
            <span className="font-mono text-[10px] truncate" title={ref.workflow_id}>{ref.workflow_id || '-'}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-500">Version</span>
            <span className="font-mono text-[10px]">{ref.version || '-'}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-500">Scope</span>
            <span className="uppercase tracking-wide text-[10px]">{scope}</span>
          </div>
        </div>
      </div>

      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  );
};
