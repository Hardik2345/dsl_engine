import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow } from '@xyflow/react';
import { X } from 'lucide-react';

export default function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
}) {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onEdgeClick = (evt) => {
    evt.stopPropagation();
    setEdges((edges) => edges.filter((edge) => edge.id !== id));
  };

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
            style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                pointerEvents: 'all',
            }}
            className="flex items-center gap-1 bg-white border border-gray-200 shadow-sm rounded px-1 py-0.5 hover:border-red-300 group"
        >
            {label && (
                <span className="text-xs text-gray-500 font-medium px-1">{label}</span>
            )}
            <button
                className="w-4 h-4 rounded-full bg-transparent hover:bg-red-100 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors"
                onClick={onEdgeClick}
                title="Delete connection"
            >
                <X className="w-3 h-3" />
            </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
