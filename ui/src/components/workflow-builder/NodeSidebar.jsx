import React from 'react';
import { AlertCircle, GitFork, BarChart3, Lightbulb, SplitSquareVertical, Layers } from 'lucide-react';

const SidebarItem = ({ type, label, icon: Icon, colorClass, onDragStart }) => (
  <div
    className={`flex items-center gap-3 p-3 mb-2 bg-white border rounded cursor-grab hover:shadow-md transition-shadow ${colorClass}`}
    onDragStart={(event) => onDragStart(event, type)}
    draggable
  >
    <Icon className="w-5 h-5" />
    <span className="text-sm font-medium">{label}</span>
  </div>
);

export default function NodeSidebar() {
  const onDragStart = (event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="w-64 bg-gray-50 border-r border-gray-200 p-4 flex flex-col h-full">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
        Components
      </h3>
      
      <div className="space-y-1">
        <SidebarItem 
            type="validation" 
            label="Validation Check" 
            icon={AlertCircle} 
            colorClass="border-yellow-200 text-yellow-700"
            onDragStart={onDragStart}
        />
        
        <SidebarItem 
            type="branch" 
            label="Logic Branch" 
            icon={GitFork} 
            colorClass="border-purple-200 text-purple-700"
            onDragStart={onDragStart}
        />

        <SidebarItem 
            type="metric_compare" 
            label="Metric Compare" 
            icon={BarChart3} 
            colorClass="border-blue-200 text-blue-700"
            onDragStart={onDragStart}
        />

        <SidebarItem 
            type="metric_breakdown" 
            label="Dimension Breakdown" 
            icon={SplitSquareVertical} 
            colorClass="border-indigo-200 text-indigo-700"
            onDragStart={onDragStart}
        />

        <SidebarItem 
            type="composite" 
            label="Composite / Group" 
            icon={Layers} 
            colorClass="border-gray-300 text-gray-700 bg-gray-50"
            onDragStart={onDragStart}
        />

        <SidebarItem 
            type="insight" 
            label="Insight Generator" 
            icon={Lightbulb} 
            colorClass="border-green-200 text-green-700"
            onDragStart={onDragStart}
        />
      </div>

      <div className="mt-auto p-4 bg-blue-50 rounded-lg text-xs text-blue-700">
        <p className="font-semibold mb-1">Tip:</p>
        Drag and drop nodes onto the canvas to build your workflow.
      </div>
    </div>
  );
}
