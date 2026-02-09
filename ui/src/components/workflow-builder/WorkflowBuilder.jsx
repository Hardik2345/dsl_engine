import React, { useCallback, useState, useEffect } from 'react';
import { ReactFlowProvider, useNodesState, useEdgesState, addEdge, MarkerType } from '@xyflow/react';
import { ArrowLeft, Save, Layout } from 'lucide-react';
import toast from 'react-hot-toast';

import NodeSidebar from './NodeSidebar';
import WorkflowCanvas from './WorkflowCanvas';
import PropertiesPanel from './PropertiesPanel';
import { jsonToGraph, graphToJson } from '../../utils/workflowTransformers';

function WorkflowBuilderContent({ initialData, onSave, onBack, isEditing }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [metadata, setMetadata] = useState(initialData || {});

  // Initialize graph from JSON on mount
  useEffect(() => {
    if (initialData) {
      const { nodes: flowNodes, edges: flowEdges } = jsonToGraph(initialData);
      setNodes(flowNodes);
      setEdges(flowEdges);
    }
  }, [initialData, setNodes, setEdges]);

  const onConnect = useCallback(
    (params) => {
        let newEdge = { 
          ...params, 
          type: 'deletable', 
          markerEnd: { type: MarkerType.ArrowClosed } 
        };

        // Styling for Rule connections (Branch Node)
        if (params.sourceHandle && params.sourceHandle.startsWith('handle-rule-')) {
             const ruleIdx = params.sourceHandle.split('-')[2];
             newEdge = { 
                ...newEdge, 
                style: { stroke: '#9333ea' },
                label: `Rule ${parseInt(ruleIdx) + 1}`,
             };
        } 
        // Styling for Default path (Branch Node)
        else if (params.sourceHandle === 'handle-default') {
             newEdge = { 
                ...newEdge, 
                animated: true,
                label: 'Default',
                style: { stroke: '#6b7280' }
             };
        }
        // Styling for Composite Steps
        // (If we had specific handles for steps, we would check here. 
        // For now, if source is composite and target is not 'final', we might assume...)
        
        setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges],
  );

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  const handleNodeUpdate = (id, newData) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          // If ID changed in data, we might need to update node.id too, 
          // but React Flow prefers stable IDs. Ideally keep display ID separate from internal ID.
          // For now, update data only.
          return { ...node, data: newData };
        }
        return node;
      })
    );
    // Update local selection state too
    setSelectedNode((prev) => ({ ...prev, data: newData }));
  };

  const handleNodeDelete = (id) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedNode(null);
  };

  const handleSave = () => {
    try {
      const workflowJson = graphToJson(nodes, edges, metadata);
      // Validate or cleanup
      onSave(workflowJson);
      toast.success('Workflow converted to JSON successfully');
    } catch (error) {
      console.error(error);
      toast.error('Failed to generate workflow JSON');
    }
  };

  const handleAutoLayout = () => {
     const { nodes: layoutedNodes, edges: layoutedEdges } = jsonToGraph(graphToJson(nodes, edges, metadata));
     setNodes([...layoutedNodes]);
     setEdges([...layoutedEdges]);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-500"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                className="text-lg font-semibold text-gray-900 border border-transparent focus:border-gray-300 rounded px-2 py-1 min-w-[180px]"
                value={metadata.workflow_id || ''}
                onChange={(e) => setMetadata((m) => ({ ...m, workflow_id: e.target.value }))}
                placeholder="workflow_id"
                disabled={isEditing}
              />
              <span className="text-xs text-gray-500">Visual Editor</span>
            </div>
            <input
              className="mt-1 text-xs text-gray-700 border border-gray-200 rounded px-2 py-1 w-full max-w-md"
              value={metadata.description || ''}
              onChange={(e) => setMetadata((m) => ({ ...m, description: e.target.value }))}
              placeholder="Description"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
           <button
            onClick={handleAutoLayout}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
          >
            <Layout className="w-4 h-4" />
            Auto Layout
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
          >
            <Save className="w-4 h-4" />
            Save Changes
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        <NodeSidebar />
        
        <div className="flex-1 bg-gray-100 relative h-full w-full">
          <WorkflowCanvas 
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            setNodes={setNodes}
          />
        </div>

        {selectedNode && (
          <PropertiesPanel 
            selectedNode={selectedNode} 
            onChange={handleNodeUpdate}
            onClose={() => setSelectedNode(null)}
            onDelete={handleNodeDelete}
          />
        )}
      </div>
    </div>
  );
}

export default function WorkflowBuilder(props) {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderContent {...props} />
    </ReactFlowProvider>
  );
}
