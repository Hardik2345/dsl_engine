import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Layers } from 'lucide-react';

export const CompositeNode = ({ data, isConnectable }) => {
  return (
    <div className="w-[300px] bg-white border-2 border-gray-600 rounded-lg shadow-sm">
      <div className="bg-gray-100 px-3 py-2 border-b border-gray-300 rounded-t-lg flex items-center gap-2">
        <Layers className="w-4 h-4 text-gray-700" />
        <span className="text-sm font-medium text-gray-900">{data.id}</span>
      </div>

      <div className="p-3 text-xs text-gray-600">
        <div className="font-semibold text-gray-800 mb-1">Composite Steps</div>
        <div className="space-y-1">
          {data.steps?.map((stepId, index) => (
            <div key={index} className="flex items-center justify-between bg-gray-50 border border-gray-200 px-2 py-1 rounded">
                <span>{stepId}</span>
                {/* 
                   We need handles for each step if we want to visualize flow *into* them.
                   However, composite nodes in this engine seem to function as a container 
                   that executes a list of other nodes sequentially or in parallel.
                   
                   If the nodes 'product_breakdown' and 'traffic_source_breakdown' exist in the graph 
                   independently, this composite node is just a wrapper/referencer.
                   
                   The visual representation is tricky.
                   Option A: Treat it as a black box (current implementation needs this).
                   Option B: Visualize connections to the step nodes.
                */}
            </div>
          ))}
        </div>
      </div>

      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  );
};
