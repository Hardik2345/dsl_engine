import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Lightbulb } from 'lucide-react';

export const InsightNode = ({ data, isConnectable }) => {
  return (
    <div className="w-[250px] bg-white border-2 border-green-400 rounded-lg shadow-sm">
        <div className="bg-green-50 px-3 py-2 border-b border-green-200 rounded-t-lg flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-green-600" />
            <span className="text-sm font-medium text-green-900">{data.id}</span>
        </div>
        
        <div className="p-3 text-xs text-gray-600 italic">
            "{typeof data.template === 'object' && data.template !== null 
                ? (data.template.summary || JSON.stringify(data.template))
                : (data.template || 'Final output')}"
        </div>

        <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
        {/* Insight is usually a terminal node, but could flow elsewhere */}
        <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  );
};
