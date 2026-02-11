import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

export default function PropertiesPanel({ selectedNode, onChange, onClose, onDelete }) {
  const [data, setData] = useState(selectedNode?.data || {});

  useEffect(() => {
    setData(selectedNode?.data || {});
  }, [selectedNode]);

  const handleChange = (field, value) => {
    const newData = { ...data, [field]: value };
    setData(newData);
    onChange(selectedNode.id, newData);
  };

  if (!selectedNode) {
    return null;
  }

  // Common Header
  const renderHeader = () => (
    <div className="flex items-center justify-between p-4 border-b">
      <h3 className="font-semibold text-gray-800">Properties</h3>
      <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  // Common Fields (ID, Description)
  const renderCommonFields = () => (
    <div className="space-y-3 mb-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Node ID</label>
        <input
          type="text"
          value={data.id || ''}
          onChange={(e) => handleChange('id', e.target.value)}
          className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
      </div>
    </div>
  );

  const renderContent = () => {
    switch (selectedNode.type) {
      case 'branch':
        return (
          <div className="space-y-4">
            <div className="text-sm font-medium text-gray-700">Rules</div>
            {(data.rules || []).map((rule, ruleIdx) => {
               const isBreakdownsRule = !!rule.any_in_breakdowns;
               const isOr = !isBreakdownsRule && rule.any && rule.any.length > 0;
               const currentList = isBreakdownsRule
                 ? (rule.any_in_breakdowns?.conditions || [])
                 : (isOr ? rule.any : (rule.all || []));
               
               return (
                  <div key={ruleIdx} className="p-3 bg-gray-50 rounded border text-xs relative group">
                    <div className="flex justify-between items-center mb-2">
                       <span className="font-semibold text-gray-700">Rule {ruleIdx + 1}</span>
                       <div className="flex items-center gap-2">
                           <select
                               className="text-[10px] border border-gray-300 rounded px-2 py-0.5 bg-white"
                               value={isBreakdownsRule ? 'breakdowns' : 'metrics'}
                               onChange={(e) => {
                                  const mode = e.target.value;
                                  const newRules = [...data.rules];
                                  if (mode === 'breakdowns') {
                                    newRules[ruleIdx] = {
                                      ...newRules[ruleIdx],
                                      any_in_breakdowns: {
                                        dimension: newRules[ruleIdx]?.any_in_breakdowns?.dimension || '',
                                        limit: newRules[ruleIdx]?.any_in_breakdowns?.limit ?? '',
                                        conditions: newRules[ruleIdx]?.any_in_breakdowns?.conditions || [{ metric: '', op: '>', value: '' }]
                                      },
                                      all: [],
                                      any: []
                                    };
                                  } else {
                                    newRules[ruleIdx] = {
                                      ...newRules[ruleIdx],
                                      any_in_breakdowns: undefined,
                                      all: (newRules[ruleIdx].all && newRules[ruleIdx].all.length)
                                        ? newRules[ruleIdx].all
                                        : [{ metric: '', op: '>', value: '' }],
                                      any: []
                                    };
                                  }
                                  handleChange('rules', newRules);
                               }}
                           >
                               <option value="metrics">Metrics</option>
                               <option value="breakdowns">Breakdowns</option>
                           </select>
                           <div className="flex bg-white rounded border border-gray-300 overflow-hidden">
                               <button 
                                   className={`px-2 py-0.5 text-[10px] ${!isOr ? 'bg-purple-100 text-purple-700 font-bold' : 'text-gray-500 hover:bg-gray-50'}`}
                                   onClick={() => {
                                       if (isBreakdownsRule) return;
                                       const newRules = [...data.rules];
                                       // Switch to AND: move content to 'all', clear 'any'
                                       if (isOr) {
                                           newRules[ruleIdx] = { ...newRules[ruleIdx], all: rule.any, any: [] };
                                           handleChange('rules', newRules);
                                       }
                                   }}
                               >AND</button>
                               <div className="w-px bg-gray-300"></div>
                               <button 
                                  className={`px-2 py-0.5 text-[10px] ${isOr ? 'bg-purple-100 text-purple-700 font-bold' : 'text-gray-500 hover:bg-gray-50'}`}
                                  onClick={() => {
                                       if (isBreakdownsRule) return;
                                       const newRules = [...data.rules];
                                       // Switch to OR: move content to 'any', clear 'all'
                                       if (!isOr) {
                                           newRules[ruleIdx] = { ...newRules[ruleIdx], any: rule.all || [], all: [] };
                                           handleChange('rules', newRules);
                                       }
                                  }}
                               >OR</button>
                           </div>
                           <button 
                                onClick={() => {
                                    const newRules = [...data.rules];
                                    newRules.splice(ruleIdx, 1);
                                    handleChange('rules', newRules);
                                }}
                                className="p-1 hover:bg-red-100 text-red-500 rounded transition-colors"
                                title="Delete Rule"
                           >
                                <Trash2 className="w-3 h-3" />
                           </button>
                       </div>
                    </div>
                    
                    <div className="space-y-2">
                       {isBreakdownsRule && (
                         <div className="grid grid-cols-2 gap-2 mb-2">
                           <div>
                             <label className="block text-[10px] text-gray-500 mb-1">Dimension</label>
                             <input
                               placeholder="landing_page_path"
                               className="w-full border p-1 rounded"
                               value={rule.any_in_breakdowns?.dimension || ''}
                               onChange={(e) => {
                                 const newRules = [...data.rules];
                                 const current = newRules[ruleIdx].any_in_breakdowns || {};
                                 newRules[ruleIdx].any_in_breakdowns = { ...current, dimension: e.target.value };
                                 handleChange('rules', newRules);
                               }}
                             />
                           </div>
                           <div>
                             <label className="block text-[10px] text-gray-500 mb-1">Top K</label>
                             <input
                               type="number"
                               min="1"
                               placeholder="9"
                               className="w-full border p-1 rounded"
                               value={rule.any_in_breakdowns?.limit ?? ''}
                               onChange={(e) => {
                                 const newRules = [...data.rules];
                                 const current = newRules[ruleIdx].any_in_breakdowns || {};
                                 const nextValue = e.target.value === '' ? '' : Number(e.target.value);
                                 newRules[ruleIdx].any_in_breakdowns = { ...current, limit: nextValue };
                                 handleChange('rules', newRules);
                               }}
                             />
                           </div>
                         </div>
                       )}
                       {currentList.map((cond, condIdx) => (
                           <div key={condIdx} className="flex gap-1 items-center">
                               <input 
                                  placeholder="Metric" 
                                  className="w-full border p-1 rounded min-w-0" 
                                  value={cond.metric || ''} 
                                  onChange={(e) => {
                                     const newRules = [...data.rules];
                                     if (isBreakdownsRule) {
                                       const current = newRules[ruleIdx].any_in_breakdowns || {};
                                       const conditions = current.conditions || [];
                                       conditions[condIdx] = { ...conditions[condIdx], metric: e.target.value };
                                       newRules[ruleIdx].any_in_breakdowns = { ...current, conditions };
                                     } else {
                                       const listKey = isOr ? 'any' : 'all';
                                       if (!newRules[ruleIdx][listKey]) newRules[ruleIdx][listKey] = [];
                                       newRules[ruleIdx][listKey][condIdx] = { ...newRules[ruleIdx][listKey][condIdx], metric: e.target.value };
                                     }
                                     handleChange('rules', newRules);
                                  }}
                               />
                               <select 
                                   className="border p-1 rounded shrink-0 w-12 text-center"
                                   value={cond.op || '>'}
                                   onChange={(e) => {
                                      const newRules = [...data.rules];
                                      if (isBreakdownsRule) {
                                        const current = newRules[ruleIdx].any_in_breakdowns || {};
                                        const conditions = current.conditions || [];
                                        conditions[condIdx] = { ...conditions[condIdx], op: e.target.value };
                                        newRules[ruleIdx].any_in_breakdowns = { ...current, conditions };
                                      } else {
                                        const listKey = isOr ? 'any' : 'all';
                                        newRules[ruleIdx][listKey][condIdx] = { ...newRules[ruleIdx][listKey][condIdx], op: e.target.value };
                                      }
                                      handleChange('rules', newRules);
                                   }}
                               >
                                   <option value=">">&gt;</option>
                                   <option value=">=">&ge;</option>
                                   <option value="<">&lt;</option>
                                   <option value="<=">&le;</option>
                                   <option value="==">=</option>
                                   <option value="!=">!=</option>
                               </select>
                               <input 
                                  placeholder="Value" 
                                  className="w-full border p-1 rounded min-w-0"
                                  value={cond.value || ''} 
                                  onChange={(e) => {
                                       const newRules = [...data.rules];
                                       if (isBreakdownsRule) {
                                         const current = newRules[ruleIdx].any_in_breakdowns || {};
                                         const conditions = current.conditions || [];
                                         conditions[condIdx] = { ...conditions[condIdx], value: e.target.value };
                                         newRules[ruleIdx].any_in_breakdowns = { ...current, conditions };
                                       } else {
                                         const listKey = isOr ? 'any' : 'all';
                                         newRules[ruleIdx][listKey][condIdx] = { ...newRules[ruleIdx][listKey][condIdx], value: e.target.value };
                                       }
                                       handleChange('rules', newRules);
                                  }}
                                />
                                <button 
                                    onClick={() => {
                                        const newRules = [...data.rules];
                                        if (isBreakdownsRule) {
                                          const current = newRules[ruleIdx].any_in_breakdowns || {};
                                          const conditions = current.conditions || [];
                                          conditions.splice(condIdx, 1);
                                          newRules[ruleIdx].any_in_breakdowns = { ...current, conditions };
                                        } else {
                                          const listKey = isOr ? 'any' : 'all';
                                          newRules[ruleIdx][listKey].splice(condIdx, 1);
                                        }
                                        handleChange('rules', newRules);
                                    }}
                                    className="text-gray-400 hover:text-red-500 p-0.5"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                           </div>
                       ))}
                       <button 
                            onClick={() => {
                                const newRules = [...data.rules];
                                if (isBreakdownsRule) {
                                  const current = newRules[ruleIdx].any_in_breakdowns || {};
                                  const conditions = current.conditions || [];
                                  conditions.push({ metric: '', op: '>', value: '' });
                                  newRules[ruleIdx].any_in_breakdowns = { ...current, conditions };
                                } else {
                                  const listKey = isOr ? 'any' : 'all';
                                  if (!newRules[ruleIdx][listKey]) newRules[ruleIdx][listKey] = [];
                                  newRules[ruleIdx][listKey].push({ metric: '', op: '>', value: '' });
                                }
                                handleChange('rules', newRules);
                            }}
                            className="text-blue-600 text-[10px] hover:underline flex items-center gap-1 mt-1"
                        >
                            <Plus className="w-3 h-3" /> Add Condition
                        </button>
                    </div>
                  </div>
               );
            })}
            <button 
                onClick={() => {
                    const newRules = [...(data.rules || []), { all: [{ metric: '', op: '>', value: '' }] }];
                    handleChange('rules', newRules);
                }}
                className="w-full py-2 border-2 border-dashed border-gray-300 rounded text-gray-500 hover:border-blue-500 hover:text-blue-500 text-sm flex items-center justify-center gap-2"
            >
                <Plus className="w-4 h-4" /> Add Rule
            </button>
          </div>
        );
      
      case 'validation':
        return (
            <div className="space-y-2">
                <div className="text-sm font-medium text-gray-700">Checks</div>
                 {(data.checks || []).map((check, idx) => (
                     <div key={idx} className="flex gap-2 text-sm items-center">
                         <input 
                            className="border p-1 rounded flex-1 min-w-0" 
                            value={check.field} 
                            placeholder="Field"
                            onChange={(e) => {
                                const newChecks = [...data.checks];
                                newChecks[idx].field = e.target.value;
                                handleChange('checks', newChecks);
                            }}
                         />
                         <input 
                            className="border p-1 rounded flex-[2] min-w-0" 
                            value={check.condition}
                            placeholder="Condition"
                            onChange={(e) => {
                                const newChecks = [...data.checks];
                                newChecks[idx].condition = e.target.value;
                                handleChange('checks', newChecks);
                            }}
                         />
                         <button 
                            onClick={() => {
                                const newChecks = [...data.checks];
                                newChecks.splice(idx, 1);
                                handleChange('checks', newChecks);
                            }}
                            className="p-1 hover:bg-red-50 text-red-500 rounded flex-shrink-0"
                            title="Delete Check"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                     </div>
                 ))}
                  <button 
                    onClick={() => {
                        const newChecks = [...(data.checks || []), { field: '', condition: '' }];
                        handleChange('checks', newChecks);
                    }}
                    className="text-blue-600 text-xs hover:underline flex items-center gap-1"
                >
                    <Plus className="w-3 h-3" /> Add Check
                </button>
            </div>
        );
      case 'composite':
        return (
            <div className="space-y-4">
                <div className="text-sm font-medium text-gray-700">Steps (Node IDs)</div>
                <div className="text-xs text-gray-500 mb-2">
                    Enter the IDs of the nodes that should be executed in this composite block.
                </div>
                {(data.steps || []).map((stepId, idx) => (
                    <div key={idx} className="flex gap-2 mb-2">
                        <input
                            className="w-full border p-1 rounded text-sm"
                            value={stepId}
                            onChange={(e) => {
                                const newSteps = [...(data.steps || [])];
                                newSteps[idx] = e.target.value;
                                handleChange('steps', newSteps);
                            }}
                            placeholder="Node ID"
                        />
                         <button 
                            onClick={() => {
                                const newSteps = [...(data.steps || [])];
                                newSteps.splice(idx, 1);
                                handleChange('steps', newSteps);
                            }}
                            className="p-1 hover:bg-red-50 text-red-500 rounded"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ))}
                 <button 
                    onClick={() => {
                        const newSteps = [...(data.steps || []), ''];
                        handleChange('steps', newSteps);
                    }}
                    className="w-full py-1.5 border border-dashed text-gray-500 rounded text-xs hover:border-gray-400 flex items-center justify-center gap-1"
                >
                    <Plus className="w-3 h-3" /> Add Step
                </button>
            </div>
        );

      case 'analysis':
      case 'metric_compare':
      case 'metric_breakdown':
      case 'recursive_dimension_breakdown': 
          return (
             <div className="space-y-3">
                 <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                    <select 
                        value={data.type === 'metric_compare' ? 'metric_compare' : 'recursive_dimension_breakdown'} 
                        onChange={(e) => handleChange('type', e.target.value)}
                        className="w-full text-sm border-gray-300 rounded"
                    >
                        <option value="metric_compare">Metric Comparison</option>
                        <option value="recursive_dimension_breakdown">Dimension Breakdown</option>
                    </select>
                 </div>
                 
                 {data.type === 'metric_compare' ? (
                     <div>
                         <label className="block text-xs font-medium text-gray-500 mb-1">Metrics (comma separated)</label>
                         <input 
                            type="text" 
                            className="w-full border text-sm p-1 rounded" 
                            value={(data.metrics || []).join(', ')}
                            onChange={(e) => handleChange('metrics', e.target.value.split(',').map(s => s.trim()))}
                         />
                     </div>
                 ) : (
                    <>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Base Metric</label>
                            <input 
                                type="text" 
                                className="w-full border text-sm p-1 rounded" 
                                value={data.base_metric || ''}
                                onChange={(e) => handleChange('base_metric', e.target.value)}
                            />
                        </div>
                        <div>
                             <label className="block text-xs font-medium text-gray-500 mb-1">Dimensions (comma separated)</label>
                             <input 
                                type="text" 
                                className="w-full border text-sm p-1 rounded" 
                                value={(data.dimensions || []).join(', ')}
                                onChange={(e) => handleChange('dimensions', e.target.value.split(',').map(s => s.trim()))}
                             />
                        </div>
                    </>
                 )}
             </div>
          );

      case 'insight':
          const isStructured = typeof data.template === 'object' && data.template !== null;
          
          return (
             <div className="space-y-4">
                 <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Template Type</label>
                    <div className="flex gap-2">
                         <button
                            className={`px-3 py-1 text-xs rounded border ${!isStructured ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-gray-200 text-gray-600'}`}
                            onClick={() => handleChange('template', '')}
                         >
                            Simple Text
                         </button>
                         <button
                            className={`px-3 py-1 text-xs rounded border ${isStructured ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-gray-200 text-gray-600'}`}
                            onClick={() => handleChange('template', { summary: '', details: [], confidence: '' })}
                         >
                            Structured
                         </button>
                    </div>
                 </div>

                 {!isStructured ? (
                     <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Message Template</label>
                        <textarea
                            className="w-full border p-2 rounded text-sm min-h-[100px]"
                            value={typeof data.template === 'string' ? data.template : ''}
                            onChange={(e) => handleChange('template', e.target.value)}
                            placeholder="Analysis complete for {{meta.metric}}..."
                        />
                         <div className="text-[10px] text-gray-400 mt-1">
                             Use {'{{variable}}'} for dynamic values.
                         </div>
                     </div>
                 ) : (
                     <div className="space-y-3">
                         <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Summary Template</label>
                            <textarea
                                className="w-full border p-2 rounded text-sm min-h-[60px]"
                                value={data.template.summary || ''}
                                onChange={(e) => handleChange('template', { ...data.template, summary: e.target.value })}
                                placeholder="Summary text..."
                            />
                         </div>
                         
                         <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Details (List)</label>
                            {(data.template.details || []).map((detail, idx) => (
                                <div key={idx} className="flex gap-2 mb-2">
                                    <textarea
                                        className="w-full border p-1 rounded text-xs min-h-[40px]"
                                        value={detail}
                                        onChange={(e) => {
                                            const newDetails = [...(data.template.details || [])];
                                            newDetails[idx] = e.target.value;
                                            handleChange('template', { ...data.template, details: newDetails });
                                        }}
                                    />
                                    <button 
                                        onClick={() => {
                                            const newDetails = [...(data.template.details || [])];
                                            newDetails.splice(idx, 1);
                                            handleChange('template', { ...data.template, details: newDetails });
                                        }}
                                        className="p-1 h-fit hover:bg-red-50 text-red-500 rounded"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                            <button 
                                onClick={() => {
                                    const newDetails = [...(data.template.details || []), ''];
                                    handleChange('template', { ...data.template, details: newDetails });
                                }}
                                className="text-blue-600 text-xs hover:underline flex items-center gap-1"
                            >
                                <Plus className="w-3 h-3" /> Add Detail Line
                            </button>
                         </div>

                         <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Confidence Score (Optional)</label>
                             <input 
                                className="w-full border p-1 rounded text-sm" 
                                value={data.template.confidence || ''}
                                onChange={(e) => handleChange('template', { ...data.template, confidence: e.target.value })}
                                placeholder="{{confidence_score}}"
                            />
                         </div>
                     </div>
                 )}
             </div>
          );

      default:
        return <div className="text-sm text-gray-500 italic">No specific properties for this node type.</div>;
    }
  };

  return (
    <div className="w-80 border-l border-gray-200 bg-white h-full overflow-y-auto">
      {renderHeader()}
      <div className="p-4">
        {renderCommonFields()}
        <hr className="my-4 border-gray-100" />
        {renderContent()}
        
        <div className="mt-8 pt-4 border-t border-gray-100">
           <button 
            onClick={() => onDelete(selectedNode.id)}
            className="w-full py-2 bg-red-50 text-red-600 rounded-md text-sm hover:bg-red-100 flex items-center justify-center gap-2"
           >
               <Trash2 className="w-4 h-4" /> Delete Node
           </button>
        </div>
      </div>
    </div>
  );
}
