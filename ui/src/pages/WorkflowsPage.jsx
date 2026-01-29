import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Plus, Play, Eye, GitBranch, Edit2, Trash2, Clock } from 'lucide-react';
import { useWorkflows, useDeleteWorkflow } from '../api/hooks';
import { useTenant } from '../context/TenantContext';
import { Button, Badge, Card, PageSpinner, EmptyState } from '../components/ui';
import RunWorkflowModal from '../components/RunWorkflowModal';
import CreateWorkflowModal from '../components/CreateWorkflowModal';
import EditWorkflowModal from '../components/EditWorkflowModal';
import toast from 'react-hot-toast';

export default function WorkflowsPage() {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const { data: workflows, isLoading, error } = useWorkflows();
  const deleteWorkflow = useDeleteWorkflow();
  
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [workflowToEdit, setWorkflowToEdit] = useState(null);

  if (isLoading) return <PageSpinner />;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Error loading workflows: {error.message}</p>
      </div>
    );
  }

  const handleRunClick = (workflow) => {
    setSelectedWorkflow(workflow);
    setRunModalOpen(true);
  };

  const handleEditClick = (workflow) => {
    setWorkflowToEdit(workflow);
    setEditModalOpen(true);
  };

  const handleDeleteClick = async (workflow) => {
    if (!confirm(`Are you sure you want to delete workflow "${workflow.workflowId}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteWorkflow.mutateAsync(workflow.workflowId);
      toast.success(`Workflow "${workflow.workflowId}" deleted successfully`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete workflow');
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
          <p className="text-gray-500 mt-1">
            Manage and run your workflow definitions for {tenantId}
          </p>
        </div>
        <Button onClick={() => setCreateModalOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Workflow
        </Button>
      </div>

      {/* Workflows Table */}
      {workflows?.length === 0 ? (
        <Card>
          <EmptyState
            icon={GitBranch}
            title="No workflows yet"
            description="Create your first workflow to get started with automated analysis."
            action={
              <Button onClick={() => setCreateModalOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Workflow
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-6 text-sm font-medium text-gray-500 uppercase tracking-wider">
                    Workflow
                  </th>
                  <th className="text-left py-3 px-6 text-sm font-medium text-gray-500 uppercase tracking-wider">
                    Version
                  </th>
                  <th className="text-left py-3 px-6 text-sm font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left py-3 px-6 text-sm font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="text-right py-3 px-6 text-sm font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {workflows?.map((workflow) => (
                  <tr key={workflow._id} className="hover:bg-gray-50">
                    <td className="py-4 px-6">
                      <div>
                        <Link
                          to={`/workflows/${workflow.workflowId}`}
                          className="font-medium text-gray-900 hover:text-primary-600"
                        >
                          {workflow.workflowId}
                        </Link>
                        {workflow.name && workflow.name !== workflow.workflowId && (
                          <p className="text-sm text-gray-500">{workflow.name}</p>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span className="text-sm text-gray-600">
                        v{workflow.latestVersion}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <Badge status={workflow.isActive ? 'active' : 'inactive'}>
                        {workflow.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="py-4 px-6 text-sm text-gray-500">
                      {workflow.createdAt
                        ? format(new Date(workflow.createdAt), 'MMM d, yyyy')
                        : '-'}
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRunClick(workflow)}
                          title="Run workflow"
                        >
                          <Play className="w-4 h-4" />
                        </Button>
                        <Link to={`/workflows/${workflow.workflowId}`}>
                          <Button variant="ghost" size="sm" title="View details">
                            <Eye className="w-4 h-4" />
                          </Button>
                        </Link>
                        <Link to={`/workflows/${workflow.workflowId}/runs`}>
                          <Button variant="ghost" size="sm" title="View runs">
                            <Clock className="w-4 h-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditClick(workflow)}
                          title="Edit workflow"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(workflow)}
                          title="Delete workflow"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Run Workflow Modal */}
      {runModalOpen && selectedWorkflow && (
        <RunWorkflowModal
          workflow={selectedWorkflow}
          onClose={() => {
            setRunModalOpen(false);
            setSelectedWorkflow(null);
          }}
        />
      )}

      {/* Create Workflow Modal */}
      {createModalOpen && (
        <CreateWorkflowModal onClose={() => setCreateModalOpen(false)} />
      )}

      {/* Edit Workflow Modal */}
      {editModalOpen && workflowToEdit && (
        <EditWorkflowModal
          workflow={workflowToEdit}
          onClose={() => {
            setEditModalOpen(false);
            setWorkflowToEdit(null);
          }}
        />
      )}
    </div>
  );
}
