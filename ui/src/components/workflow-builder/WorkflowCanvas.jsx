import React, { useCallback, useRef } from 'react';
import { ReactFlow, Controls, Background, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ValidationNode } from './nodes/ValidationNode';
import { BranchNode } from './nodes/BranchNode';
import { AnalysisNode } from './nodes/AnalysisNode';
import { InsightNode } from './nodes/InsightNode';
import { CompositeNode } from './nodes/CompositeNode';
import DeletableEdge from './edges/DeletableEdge';

const nodeTypes = {
  validation: ValidationNode,
  branch: BranchNode,
  analysis: AnalysisNode,
  insight: InsightNode,
  composite: CompositeNode,
};

const edgeTypes = {
  deletable: DeletableEdge,
};

export default function WorkflowCanvas({ 
  nodes, 
  edges, 
  onNodesChange, 
  onEdgesChange, 
  onConnect,
  onNodeClick,
  setNodes
}) {
  const reactFlowWrapper = useRef(null);
  const { screenToFlowPosition } = useReactFlow();

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (typeof type === 'undefined' || !type) {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Map drag types to component types
      let componentType = type;
      if (type === 'metric_compare' || type === 'metric_breakdown') {
         componentType = 'analysis';
      }

      const newNode = {
        id: `node_${Date.now()}`,
        type: componentType,
        position,
        data: { 
            id: `new_${type}_${Date.now().toString().slice(-4)}`, 
            // Default data structure based on type
            ...(type === 'branch' ? { type: 'branch', rules: [] } : {}),
            ...(type === 'validation' ? { type: 'validation', checks: [] } : {}),
            ...(type === 'metric_compare' ? { type: 'metric_compare', metrics: [] } : {}),
            ...(type === 'metric_breakdown' ? { type: 'recursive_dimension_breakdown', dimensions: [], base_metric: 'orders' } : {}),
            ...(type === 'composite' ? { type: 'composite', steps: [] } : {}),
            ...(type === 'insight' ? { type: 'insight', template: '' } : {})
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes],
  );

  return (
    <div className="w-full h-full" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onDragOver={onDragOver}
        onDrop={onDrop}
        fitView
      >
        <Controls position="top-right" />
        <Background gap={12} size={1} />
      </ReactFlow>
    </div>
  );
}
