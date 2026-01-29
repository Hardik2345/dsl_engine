import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCreateWorkflow } from '../api/hooks';
import { Button } from './ui';

const WORKFLOW_TEMPLATE = {
  workflow_id: '',
  workflow_type: 'root_cause_analysis',
  description: '',
  version: '1.0',
  trigger: {
    type: 'alert',
    metric: 'cvr',
    condition: {
      operator: '<',
      delta_pct: -15,
    },
    window: {
      type: 'rolling',
      duration: '1h',
    },
  },
  context: {},
  nodes: [
    {
      id: 'data_sanity_check',
      type: 'validation',
      checks: [
        { field: 'sessions', condition: 'current > 0' },
        { field: 'orders', condition: 'current >= 0' },
      ],
      on_fail: {
        action: 'terminate',
        reason: 'Insufficient or invalid data for RCA',
      },
      next: 'metric_decomposition',
    },
    {
      id: 'metric_decomposition',
      type: 'metric_compare',
      metrics: ['orders', 'sessions', 'cvr'],
      next: 'final_insight',
    },
    {
      id: 'final_insight',
      type: 'insight',
      template: 'Analysis complete for {{meta.metric}}',
    },
  ],
};

export default function CreateWorkflowModal({ onClose }) {
  const navigate = useNavigate();
  const createWorkflow = useCreateWorkflow();
  const [mode, setMode] = useState('form'); // 'form' or 'json'

  const [formData, setFormData] = useState({
    workflowId: '',
    description: '',
    version: '1.0',
    metric: 'cvr',
    deltaThreshold: -15,
  });

  const [jsonInput, setJsonInput] = useState(
    JSON.stringify(WORKFLOW_TEMPLATE, null, 2)
  );
  const [jsonError, setJsonError] = useState(null);

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (!formData.workflowId.trim()) {
      toast.error('Workflow ID is required');
      return;
    }

    const definition = {
      ...WORKFLOW_TEMPLATE,
      workflow_id: formData.workflowId.trim(),
      description: formData.description.trim(),
      version: formData.version,
      trigger: {
        ...WORKFLOW_TEMPLATE.trigger,
        metric: formData.metric,
        condition: {
          operator: '<',
          delta_pct: Number(formData.deltaThreshold),
        },
      },
    };

    try {
      await createWorkflow.mutateAsync(definition);
      toast.success('Workflow created successfully');
      onClose();
      navigate(`/workflows/${formData.workflowId}`);
    } catch (err) {
      toast.error(err.response?.data?.errors?.join(', ') || 'Failed to create workflow');
    }
  };

  const handleJsonSubmit = async (e) => {
    e.preventDefault();

    try {
      const definition = JSON.parse(jsonInput);
      setJsonError(null);

      await createWorkflow.mutateAsync(definition);
      toast.success('Workflow created successfully');
      onClose();
      navigate(`/workflows/${definition.workflow_id}`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setJsonError('Invalid JSON format');
      } else {
        toast.error(err.response?.data?.errors?.join(', ') || 'Failed to create workflow');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Create Workflow</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="px-6 pt-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('form')}
              className={`px-4 py-2 text-sm font-medium rounded-lg ${
                mode === 'form'
                  ? 'bg-primary-100 text-primary-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Simple Form
            </button>
            <button
              type="button"
              onClick={() => setMode('json')}
              className={`px-4 py-2 text-sm font-medium rounded-lg ${
                mode === 'json'
                  ? 'bg-primary-100 text-primary-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              JSON Editor
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {mode === 'form' ? (
            <form onSubmit={handleFormSubmit} id="create-form">
              <div className="px-6 py-4 space-y-4">
                {/* Workflow ID */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Workflow ID *
                  </label>
                  <input
                    type="text"
                    value={formData.workflowId}
                    onChange={(e) =>
                      setFormData({ ...formData, workflowId: e.target.value })
                    }
                    placeholder="e.g., cvr_drop_analysis"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Use snake_case, no spaces
                  </p>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder="Brief description of the workflow"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                {/* Version */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Version
                  </label>
                  <input
                    type="text"
                    value={formData.version}
                    onChange={(e) =>
                      setFormData({ ...formData, version: e.target.value })
                    }
                    placeholder="1.0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                {/* Trigger Metric */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Trigger Metric
                  </label>
                  <select
                    value={formData.metric}
                    onChange={(e) =>
                      setFormData({ ...formData, metric: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="cvr">CVR (Conversion Rate)</option>
                    <option value="revenue">Revenue</option>
                    <option value="orders">Orders</option>
                    <option value="sessions">Sessions</option>
                  </select>
                </div>

                {/* Delta Threshold */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Delta Threshold (%)
                  </label>
                  <input
                    type="number"
                    value={formData.deltaThreshold}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        deltaThreshold: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Negative value triggers when metric drops below threshold
                  </p>
                </div>

                <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-600">
                  <p className="font-medium mb-1">💡 Tip</p>
                  <p>
                    This creates a basic workflow template. You can add more
                    nodes and configure advanced settings by editing the workflow
                    after creation.
                  </p>
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleJsonSubmit} id="create-form">
              <div className="px-6 py-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Workflow Definition (JSON)
                </label>
                <textarea
                  value={jsonInput}
                  onChange={(e) => {
                    setJsonInput(e.target.value);
                    setJsonError(null);
                  }}
                  className={`w-full h-96 px-3 py-2 font-mono text-sm border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
                    jsonError ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="Paste your workflow JSON here..."
                />
                {jsonError && (
                  <p className="text-sm text-red-500 mt-1">{jsonError}</p>
                )}
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-form"
            loading={createWorkflow.isPending}
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Workflow
          </Button>
        </div>
      </div>
    </div>
  );
}
