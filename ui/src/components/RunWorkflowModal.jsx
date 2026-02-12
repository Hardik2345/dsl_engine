import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { useExecuteWorkflow } from '../api/hooks';
import { useTenant } from '../context/TenantContext';
import { Button } from './ui';

export default function RunWorkflowModal({ workflow, onClose }) {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const executeWorkflow = useExecuteWorkflow(workflow.workflowId);

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoYesterday = new Date(weekAgo.getTime() - 24 * 60 * 60 * 1000);

  const formatDateForInput = (date) => {
    return date.toISOString().slice(0, 16);
  };

  const formatDateForApi = (dateStr) => {
    return dateStr.replace('T', ' ') + ':00';
  };

  const [formData, setFormData] = useState({
    windowStart: formatDateForInput(yesterday),
    windowEnd: formatDateForInput(now),
    baselineStart: formatDateForInput(weekAgoYesterday),
    baselineEnd: formatDateForInput(weekAgo),
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    const context = {
      meta: {
        tenantId,
        metric: 'cvr',
        window: {
          start: formatDateForApi(formData.windowStart),
          end: formatDateForApi(formData.windowEnd),
        },
        baselineWindow: {
          start: formatDateForApi(formData.baselineStart),
          end: formatDateForApi(formData.baselineEnd),
        },
      },
      filters: [],
      metrics: {},
      rootCausePath: [],
      scratch: {},
    };

    try {
      const result = await executeWorkflow.mutateAsync({ context });
      toast.success(`Workflow run started: ${result.runId}`);
      onClose();
      navigate(`/workflows/${workflow.workflowId}/runs/${result.runId}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to run workflow');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Run Workflow</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-4">
            <div className="text-sm text-gray-500 mb-4">
              Running <span className="font-medium text-gray-900">{workflow.workflowId}</span>
            </div>

            {/* Analysis Window */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Analysis Window
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Start</label>
                  <input
                    type="datetime-local"
                    value={formData.windowStart}
                    onChange={(e) => setFormData({ ...formData, windowStart: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">End</label>
                  <input
                    type="datetime-local"
                    value={formData.windowEnd}
                    onChange={(e) => setFormData({ ...formData, windowEnd: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Baseline Window */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Baseline Window
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Start</label>
                  <input
                    type="datetime-local"
                    value={formData.baselineStart}
                    onChange={(e) => setFormData({ ...formData, baselineStart: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">End</label>
                  <input
                    type="datetime-local"
                    value={formData.baselineEnd}
                    onChange={(e) => setFormData({ ...formData, baselineEnd: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={executeWorkflow.isPending}>
              <Play className="w-4 h-4 mr-2" />
              Run Workflow
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
