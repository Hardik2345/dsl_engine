import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Mail } from 'lucide-react';

export const EmailNode = ({ data, isConnectable }) => (
  <div className="w-[250px] bg-white border-2 border-cyan-400 rounded-lg shadow-sm">
    <div className="bg-cyan-50 px-3 py-2 border-b border-cyan-200 rounded-t-lg flex items-center gap-2">
      <Mail className="w-4 h-4 text-cyan-700" />
      <span className="text-sm font-medium text-cyan-950">{data.id}</span>
    </div>
    <div className="p-3 text-xs text-gray-600">
      <div className="font-semibold capitalize">{data.format || 'insight'} email</div>
      <div className="mt-1 truncate">{data.subject || 'Configure subject'}</div>
    </div>
    <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
    <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
  </div>
);
