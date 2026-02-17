import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import SuggestionInput from '../SuggestionInput';

// Generate unique ID for rules
const generateRuleId = () => `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

const INSIGHT_TOKENS = [
  'cvr_delta_pct',
  'sessions_delta_pct',
  'orders_delta_pct',
  'atc_rate_delta_pct',
  'atc_sessions_delta_pct',
  'current_orders',
  'baseline_orders',
  'current_sessions',
  'baseline_sessions',
  'current_atc_sessions',
  'baseline_atc_sessions',
  'current_cvr',
  'baseline_cvr',
  'current_atc_rate',
  'baseline_atc_rate',
  'dimension',
  'dimension_label',
  'value',
  'top1_dimension',
  'top1_dimension_label',
  'top1_value',
  'top1_cvr_delta_pct_fmt',
  'top1_atc_rate_delta_pct_fmt',
  'top1_sessions_delta_pct',
  'top1_sessions_delta_pct_fmt',
  'top1_orders_delta_pct',
  'top1_orders_delta_pct_fmt',
  'top2_dimension',
  'top2_dimension_label',
  'top2_value',
  'top2_cvr_delta_pct_fmt',
  'top2_atc_rate_delta_pct_fmt',
  'top2_sessions_delta_pct',
  'top2_sessions_delta_pct_fmt',
  'top2_orders_delta_pct',
  'top2_orders_delta_pct_fmt',
  'top3_dimension',
  'top3_dimension_label',
  'top3_value',
  'top3_cvr_delta_pct_fmt',
  'top3_atc_rate_delta_pct_fmt',
  'top3_sessions_delta_pct',
  'top3_sessions_delta_pct_fmt',
  'top3_orders_delta_pct',
  'top3_orders_delta_pct_fmt',
  'top4_dimension',
  'top4_dimension_label',
  'top4_value',
  'top4_cvr_delta_pct_fmt',
  'top4_atc_rate_delta_pct_fmt',
  'top4_sessions_delta_pct',
  'top4_sessions_delta_pct_fmt',
  'top4_orders_delta_pct',
  'top4_orders_delta_pct_fmt',
  'confidence_score',
  'cvr_delta_pct_fmt',
  'sessions_delta_pct_fmt',
  'orders_delta_pct_fmt',
  'current_cvr_pct',
  'baseline_cvr_pct',
  'top_current_cvr_pct',
  'top_baseline_cvr_pct',
  'top_cvr_delta_pct_fmt',
  'top_atc_rate_delta_pct_fmt',
  'top_atc_sessions_delta_pct_fmt',
  'top_current_sessions',
  'top_baseline_sessions',
  'top_current_orders',
  'top_baseline_orders',
  'top_current_atc_sessions',
  'top_baseline_atc_sessions',
  'top_current_atc_rate_pct',
  'top_baseline_atc_rate_pct',
  'top_sessions_delta_pct_fmt',
  'baseline_top5_pages',
  'baseline_bottom5_pages'
];

const METRIC_OPTIONS = [
  'orders',
  'sessions',
  'cvr',
  'atc_rate',
  'atc_sessions'
];

const RANK_BY_OPTIONS = [
  { value: 'delta', label: 'Delta (default)' },
  { value: 'baseline_cvr', label: 'Baseline CVR' },
  { value: 'baseline_sessions', label: 'Baseline Sessions' },
  { value: 'baseline_orders', label: 'Baseline Orders' }
];

const RANK_ORDER_OPTIONS = [
  { value: 'desc', label: 'Descending' },
  { value: 'asc', label: 'Ascending' }
];

const FILTER_MODE_OPTIONS = [
  { value: 'drop', label: 'Drops only' },
  { value: 'increase', label: 'Increases only' },
  { value: 'all', label: 'All' }
];

const MIN_SESSIONS_MODE_OPTIONS = [
  { value: 'both_low', label: 'Skip only if both are low' },
  { value: 'either_low', label: 'Skip if either is low' },
  { value: 'baseline_only', label: 'Require baseline only' }
];

const OUTPUT_KEY_SUGGESTIONS = [
  'baseline_top5_pages',
  'baseline_bottom5_pages',
  'top_pages',
  'bottom_pages',
  'top_segments',
  'bottom_segments'
];

const DIMENSION_OPTIONS = [
  'product_id',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'landing_page_path',
  'landing_page_type',
  'referrer_name'
];

const BRANCH_METRIC_OPTIONS = [
  'orders_delta_pct',
  'sessions_delta_pct',
  'cvr_delta_pct',
  'atc_rate_delta_pct',
  'atc_sessions_delta_pct',
  'current_orders',
  'baseline_orders',
  'current_sessions',
  'baseline_sessions',
  'current_atc_sessions',
  'baseline_atc_sessions',
  'current_cvr',
  'baseline_cvr',
  'current_atc_rate',
  'baseline_atc_rate',
  'sessionShare',
  'orderShare',
  'depth'
];

const VALIDATION_FIELDS = [
  'sessions',
  'orders',
  'atc_sessions',
  'cvr',
  'atc_rate'
];

function getTokenContext(text, caret) {
  if (typeof text !== 'string') return null;
  const before = text.slice(0, caret);
  const openIndex = before.lastIndexOf('{{');
  if (openIndex === -1) return null;
  const closeIndex = before.lastIndexOf('}}');
  if (closeIndex > openIndex) return null;
  const query = before.slice(openIndex + 2);
  if (!/^\w*$/.test(query)) return null;
  return { start: openIndex, end: caret, query };
}

function MetricMultiSelect({ value, onChange, placeholder }) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const normalizedValue = Array.isArray(value) ? value : [];
  const available = METRIC_OPTIONS.filter((m) => !normalizedValue.includes(m));
  const suggestions = inputValue
    ? available.filter((m) => m.startsWith(inputValue.toLowerCase()))
    : available;

  const addMetric = (metric) => {
    if (!metric || normalizedValue.includes(metric)) return;
    onChange([...normalizedValue, metric]);
    setInputValue('');
  };

  const removeMetric = (metric) => {
    onChange(normalizedValue.filter((m) => m !== metric));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const trimmed = inputValue.trim().toLowerCase();
      if (METRIC_OPTIONS.includes(trimmed)) {
        addMetric(trimmed);
      }
    }
    if (e.key === 'Backspace' && !inputValue && normalizedValue.length) {
      removeMetric(normalizedValue[normalizedValue.length - 1]);
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {normalizedValue.map((metric) => (
          <span key={metric} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs">
            {metric}
            <button
              type="button"
              className="text-gray-500 hover:text-gray-700"
              onClick={() => removeMetric(metric)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <input
          type="text"
          className="w-full border text-sm p-1 rounded"
          value={inputValue}
          onChange={(e) => {
            const next = e.target.value;
            setInputValue(next);
            if (isFocused) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setIsFocused(true);
            setIsOpen(true);
          }}
          onBlur={() => {
            setIsFocused(false);
            setTimeout(() => setIsOpen(false), 100);
          }}
          placeholder={placeholder}
        />
        {isOpen && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-h-28 overflow-y-auto rounded border border-gray-200 bg-white shadow-sm text-xs">
            <div className="flex items-center justify-between px-2 py-1 border-b border-gray-100 bg-white sticky top-0">
              <span className="text-[10px] text-gray-400">Suggestions</span>
              <button
                type="button"
                className="text-[10px] text-gray-500 hover:text-gray-700"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setIsOpen(false)}
              >
                Close
              </button>
            </div>
            {suggestions.map((metric) => (
              <button
                type="button"
                key={metric}
                className="w-full text-left px-2 py-1 hover:bg-gray-50"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addMetric(metric);
                }}
              >
                {metric}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="text-[10px] text-gray-400">
        Supported: {METRIC_OPTIONS.join(', ')}
      </div>
    </div>
  );
}

function DimensionMultiSelect({ value, onChange, placeholder }) {
  const [inputValue, setInputValue] = useState('');
  const normalizedValue = Array.isArray(value) ? value : [];
  const available = DIMENSION_OPTIONS.filter((d) => !normalizedValue.includes(d));

  const addDimension = (dimension) => {
    if (!dimension || normalizedValue.includes(dimension)) return;
    onChange([...normalizedValue, dimension]);
    setInputValue('');
  };

  const removeDimension = (dimension) => {
    onChange(normalizedValue.filter((d) => d !== dimension));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {normalizedValue.map((dimension) => (
          <span key={dimension} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs">
            {dimension}
            <button
              type="button"
              className="text-gray-500 hover:text-gray-700"
              onClick={() => removeDimension(dimension)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <SuggestionInput
        value={inputValue}
        onChange={(next) => setInputValue(next)}
        onSubmit={(next) => {
          const trimmed = next.trim().toLowerCase();
          if (DIMENSION_OPTIONS.includes(trimmed)) {
            addDimension(trimmed);
          }
        }}
        onPick={(next) => addDimension(next)}
        placeholder={placeholder}
        suggestions={available}
        footerLabel="Supported"
      />
    </div>
  );
}

function OutputKeyInput({ value, onChange, placeholder }) {
  return (
    <SuggestionInput
      value={value}
      onChange={onChange}
      onSubmit={(next) => onChange(next.trim())}
      onPick={(next) => onChange(next)}
      placeholder={placeholder}
      suggestions={OUTPUT_KEY_SUGGESTIONS}
      footerLabel="Suggestions"
    />
  );
}

function TokenTextarea({ value, onChange, placeholder, className }) {
  const textareaRef = useRef(null);
  const [context, setContext] = useState(null);

  const suggestions = useMemo(() => {
    if (!context) return [];
    const q = context.query || '';
    return INSIGHT_TOKENS.filter((token) => token.startsWith(q));
  }, [context]);

  const updateContext = (text, caret) => {
    const next = getTokenContext(text, caret);
    setContext(next);
  };

  const handleChange = (e) => {
    const nextValue = e.target.value;
    onChange(nextValue);
    updateContext(nextValue, e.target.selectionStart ?? nextValue.length);
  };

  const handleKeyUp = (e) => {
    updateContext(e.target.value, e.target.selectionStart ?? e.target.value.length);
  };

  const handleBlur = () => {
    setTimeout(() => setContext(null), 100);
  };

  const applySuggestion = (token) => {
    if (!context) return;
    const nextValue = `${value.slice(0, context.start)}{{${token}}}${value.slice(context.end)}`;
    onChange(nextValue);
    setContext(null);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const caret = context.start + token.length + 4;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        className={className}
        value={value}
        onChange={handleChange}
        onKeyUp={handleKeyUp}
        onBlur={handleBlur}
        placeholder={placeholder}
      />
      {context && suggestions.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-40 overflow-auto rounded border border-gray-200 bg-white shadow-sm text-xs">
          {suggestions.map((token) => (
            <button
              type="button"
              key={token}
              className="w-full text-left px-2 py-1 hover:bg-gray-50"
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(token);
              }}
            >
              {`{{${token}}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function parseValidationCondition(condition) {
  if (!condition || typeof condition !== 'string') {
    return { scope: 'current', op: '>', value: '' };
  }
  const match = condition.trim().match(/^(current|baseline)\s*(>=|<=|>|<|==|!=)\s*(.+)$/);
  if (!match) return { scope: 'current', op: '>', value: '' };
  return { scope: match[1], op: match[2], value: match[3] };
}

function buildValidationCondition(scope, op, value) {
  if (value === '' || value === null || value === undefined) return '';
  return `${scope} ${op} ${value}`;
}

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
  const handleStopConditionChange = (field, value, parseFn) => {
    const current = data.stop_conditions || {};
    const next = { ...current };
    if (value === '' || value === null || value === undefined) {
      delete next[field];
    } else {
      const parsed = parseFn ? parseFn(value) : Number(value);
      next[field] = Number.isNaN(parsed) ? value : parsed;
    }
    handleChange('stop_conditions', next);
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
            <datalist id="branch-metric-options">
              {BRANCH_METRIC_OPTIONS.map((metric) => (
                <option key={metric} value={metric} />
              ))}
            </datalist>
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
                               <select
                                  className="w-full border p-1 rounded min-w-0 text-xs"
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
                               >
                                  <option value="">Select metric...</option>
                                  {BRANCH_METRIC_OPTIONS.map((metric) => (
                                    <option key={metric} value={metric}>{metric}</option>
                                  ))}
                               </select>
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
                    const newRules = [...(data.rules || []), { _ruleId: generateRuleId(), all: [{ metric: '', op: '>', value: '' }] }];
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
                         <select
                            className="border p-1 rounded flex-1 min-w-0 text-xs"
                            value={check.field || ''}
                            onChange={(e) => {
                                const newChecks = [...data.checks];
                                newChecks[idx].field = e.target.value;
                                handleChange('checks', newChecks);
                            }}
                         >
                            <option value="">Select field...</option>
                            {VALIDATION_FIELDS.map((field) => (
                              <option key={field} value={field}>{field}</option>
                            ))}
                         </select>
                         {(() => {
                            const { scope, op, value } = parseValidationCondition(check.condition);
                            return (
                              <>
                                <select
                                  className="border p-1 rounded w-20 text-center text-xs"
                                  value={scope}
                                  onChange={(e) => {
                                      const newChecks = [...data.checks];
                                      const next = buildValidationCondition(e.target.value, op, value);
                                      newChecks[idx].condition = next;
                                      handleChange('checks', newChecks);
                                  }}
                                >
                                  <option value="current">current</option>
                                  <option value="baseline">baseline</option>
                                </select>
                                <select
                                  className="border p-1 rounded w-14 text-center text-xs"
                                  value={op}
                                  onChange={(e) => {
                                      const newChecks = [...data.checks];
                                      const next = buildValidationCondition(scope, e.target.value, value);
                                      newChecks[idx].condition = next;
                                      handleChange('checks', newChecks);
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
                                  className="border p-1 rounded flex-[2] min-w-0 text-xs"
                                  value={value}
                                  placeholder="Value"
                                  onChange={(e) => {
                                      const newChecks = [...data.checks];
                                      newChecks[idx].condition = buildValidationCondition(scope, op, e.target.value);
                                      handleChange('checks', newChecks);
                                  }}
                                />
                              </>
                            );
                         })()}
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
                         <label className="block text-xs font-medium text-gray-500 mb-1">Metrics</label>
                         <MetricMultiSelect
                            value={data.metrics || []}
                            onChange={(nextValue) => handleChange('metrics', nextValue)}
                            placeholder="Add metric..."
                         />
                     </div>
                 ) : (
                    <>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Base Metric</label>
                            <select
                                className="w-full border text-sm p-1 rounded"
                                value={data.base_metric || ''}
                                onChange={(e) => handleChange('base_metric', e.target.value)}
                            >
                                <option value="">Select metric...</option>
                                {METRIC_OPTIONS.map((metric) => (
                                  <option key={metric} value={metric}>{metric}</option>
                                ))}
                            </select>
                     </div>
                     <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Dimensions (comma separated)</label>
                          <DimensionMultiSelect
                             value={data.dimensions || []}
                             onChange={(nextValue) => handleChange('dimensions', nextValue)}
                             placeholder="Add dimension..."
                          />
                     </div>
                     <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Rank By</label>
                          <select
                              className="w-full border text-sm p-1 rounded"
                              value={data.rank_by || 'delta'}
                              onChange={(e) => handleChange('rank_by', e.target.value)}
                          >
                              {RANK_BY_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                          </select>
                     </div>
                     <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Rank Order</label>
                          <select
                              className="w-full border text-sm p-1 rounded"
                              value={data.rank_order || 'desc'}
                              onChange={(e) => handleChange('rank_order', e.target.value)}
                          >
                              {RANK_ORDER_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                          </select>
                     </div>
                     <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Filter Mode</label>
                          <select
                              className="w-full border text-sm p-1 rounded"
                              value={data.filter_mode || 'drop'}
                              onChange={(e) => handleChange('filter_mode', e.target.value)}
                          >
                              {FILTER_MODE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                          </select>
                     </div>
                     <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Min Sessions Mode</label>
                          <select
                              className="w-full border text-sm p-1 rounded"
                              value={data.min_sessions_mode || 'both_low'}
                              onChange={(e) => handleChange('min_sessions_mode', e.target.value)}
                          >
                              {MIN_SESSIONS_MODE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                          </select>
                     </div>
                     <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Output Key (optional)</label>
                          <OutputKeyInput
                              value={data.output_key || ''}
                              onChange={(nextValue) => handleChange('output_key', nextValue)}
                              placeholder="baseline_top5_pages"
                          />
                     </div>
                     <div className="pt-2 border-t">
                          <div className="text-xs font-medium text-gray-600 mb-2">Stop Conditions</div>
                          <div className="space-y-2">
                              <div>
                                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Max Depth</label>
                                  <input
                                      type="number"
                                      min="1"
                                      className="w-full border text-sm p-1 rounded"
                                      value={data.stop_conditions?.max_depth ?? ''}
                                      onChange={(e) => handleStopConditionChange('max_depth', e.target.value, (v) => parseInt(v, 10))}
                                      placeholder="1"
                                  />
                              </div>
                              <div>
                                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Top K</label>
                                  <input
                                      type="number"
                                      min="1"
                                      className="w-full border text-sm p-1 rounded"
                                      value={data.stop_conditions?.top_k ?? ''}
                                      onChange={(e) => handleStopConditionChange('top_k', e.target.value, (v) => parseInt(v, 10))}
                                      placeholder="5"
                                  />
                              </div>
                              <div>
                                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Min Sessions (default)</label>
                                  <input
                                      type="number"
                                      min="0"
                                      className="w-full border text-sm p-1 rounded"
                                      value={data.stop_conditions?.min_sessions ?? ''}
                                      onChange={(e) => handleStopConditionChange('min_sessions', e.target.value, (v) => parseFloat(v))}
                                      placeholder="50"
                                  />
                              </div>
                              <div>
                                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Min Current Sessions</label>
                                  <input
                                      type="number"
                                      min="0"
                                      className="w-full border text-sm p-1 rounded"
                                      value={data.stop_conditions?.min_current_sessions ?? ''}
                                      onChange={(e) => handleStopConditionChange('min_current_sessions', e.target.value, (v) => parseFloat(v))}
                                      placeholder="50"
                                  />
                              </div>
                              <div>
                                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Min Baseline Sessions</label>
                                  <input
                                      type="number"
                                      min="0"
                                      className="w-full border text-sm p-1 rounded"
                                      value={data.stop_conditions?.min_baseline_sessions ?? ''}
                                      onChange={(e) => handleStopConditionChange('min_baseline_sessions', e.target.value, (v) => parseFloat(v))}
                                      placeholder="50"
                                  />
                              </div>
                              <div>
                                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Min Impact %</label>
                                  <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      className="w-full border text-sm p-1 rounded"
                                      value={data.stop_conditions?.min_impact_pct ?? ''}
                                      onChange={(e) => handleStopConditionChange('min_impact_pct', e.target.value, (v) => parseFloat(v))}
                                      placeholder="5"
                                  />
                              </div>
                          </div>
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
                        <TokenTextarea
                            className="w-full border p-2 rounded text-sm min-h-[100px]"
                            value={typeof data.template === 'string' ? data.template : ''}
                            onChange={(nextValue) => handleChange('template', nextValue)}
                            placeholder="Analysis complete for {{cvr_delta_pct_fmt}}..."
                        />
                         <div className="text-[10px] text-gray-400 mt-1">
                             Use {'{{variable}}'} for dynamic values.
                         </div>
                     </div>
                 ) : (
                     <div className="space-y-3">
                         <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Summary Template</label>
                            <TokenTextarea
                                className="w-full border p-2 rounded text-sm min-h-[60px]"
                                value={data.template.summary || ''}
                                onChange={(nextValue) => handleChange('template', { ...data.template, summary: nextValue })}
                                placeholder="Summary text..."
                            />
                         </div>
                         
                         <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Details (List)</label>
                            {(data.template.details || []).map((detail, idx) => (
                                <div key={idx} className="flex gap-2 mb-2">
                                    <TokenTextarea
                                        className="w-full border p-1 rounded text-xs min-h-[40px]"
                                        value={detail}
                                        onChange={(nextValue) => {
                                            const newDetails = [...(data.template.details || [])];
                                            newDetails[idx] = nextValue;
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
      <div className="p-4 overflow-y-auto max-h-[calc(100vh-120px)]">
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
