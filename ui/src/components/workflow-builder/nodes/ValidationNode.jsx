import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { AlertCircle } from 'lucide-react';

export const ValidationNode = ({ data, isConnectable }) => {
  return (
    <div className="w-[250px] bg-white border-2 border-yellow-400 rounded-lg shadow-sm">
      <div className="bg-yellow-50 px-3 py-2 border-b border-yellow-200 rounded-t-lg flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-yellow-600" />
        <span className="text-sm font-medium text-yellow-900 line-clamp-1">{data.id}</span>
      </div>
      
      <div className="p-3 text-xs text-gray-600">
        <div className="font-semibold mb-1">Checks:</div>
        <ul className="list-disc pl-4 space-y-1">
          {data.checks?.map((check, idx) => (
             <li key={idx}>
               {check.field} {check.condition}
             </li>
          ))}
        </ul>
      </div>

      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  );
};
