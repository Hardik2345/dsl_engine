import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, GitCommit, Clock, Edit2, Trash2, Layout } from 'lucide-react';
import { useWorkflow, useWorkflowVersions, useDeleteWorkflow } from '../api/hooks';
import { Button, Badge, Card, CardHeader, CardContent, CardTitle, PageSpinner } from '../components/ui';
import { format } from 'date-fns';
import { useState } from 'react';
import RunWorkflowModal from '../components/RunWorkflowModal';
import EditWorkflowModal from '../components/EditWorkflowModal';
import toast from 'react-hot-toast';

export default function WorkflowDetailPage() {
  const navigate = useNavigate();
  const { workflowId } = useParams();
  const { data, isLoading, error } = useWorkflow(workflowId);
  const { data: versions } = useWorkflowVersions(workflowId);
  const deleteWorkflow = useDeleteWorkflow();
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);

  if (isLoading) return <PageSpinner />;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Error loading workflow: {error.message}</p>
        <Link to="/workflows" className="text-primary-600 hover:underline mt-4 inline-block">
          Back to Workflows
        </Link>
      </div>
    );
  }

  const { workflow, version } = data || {};
  const definition = version?.definitionJson;

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete workflow "${workflowId}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteWorkflow.mutateAsync(workflowId);
      toast.success(`Workflow "${workflowId}" deleted successfully`);
      navigate('/workflows');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete workflow');
    }
  };

  return (
    <div>
      {/* Back Link */}
      <Link
        to="/workflows"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Workflows
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{workflowId}</h1>
          <p className="text-gray-500 mt-1">
            {definition?.description || 'No description'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/workflows/${workflowId}/runs`}>
            <Button variant="secondary">
              <Clock className="w-4 h-4 mr-2" />
              View Runs
            </Button>
          </Link>
          <Link to={`/workflows/${workflowId}/edit/visual`}>
            <Button variant="secondary">
              <Layout className="w-4 h-4 mr-2" />
              Visual Editor
            </Button>
          </Link>
          <Button variant="secondary" onClick={() => setEditModalOpen(true)}>
            <Edit2 className="w-4 h-4 mr-2" />
            Edit JSON
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
          <Button onClick={() => setRunModalOpen(true)}>
            <Play className="w-4 h-4 mr-2" />
            Run Workflow
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Workflow Info */}
          <Card>
            <CardHeader>
              <CardTitle>Workflow Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-gray-500">Workflow ID</dt>
                  <dd className="font-medium">{workflowId}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Type</dt>
                  <dd className="font-medium">{definition?.workflow_type || '-'}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Latest Version</dt>
                  <dd className="font-medium">v{workflow?.latestVersion}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Status</dt>
                  <dd>
                    <Badge status={workflow?.isActive ? 'active' : 'inactive'}>
                      {workflow?.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Nodes */}
          <Card>
            <CardHeader>
              <CardTitle>Workflow Nodes ({definition?.nodes?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {definition?.nodes?.map((node, idx) => (
                  <div
                    key={node.id}
                    className="flex items-center p-3 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <span className="w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-medium mr-3">
                      {idx + 1}
                    </span>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{node.id}</p>
                      <p className="text-sm text-gray-500">Type: {node.type}</p>
                    </div>
                    {node.next && (
                      <span className="text-xs text-gray-400">→ {node.next}</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Definition JSON */}
          <Card>
            <CardHeader>
              <CardTitle>Definition JSON</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto max-h-96 text-sm">
                {JSON.stringify(definition, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Versions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <GitCommit className="w-4 h-4 mr-2" />
                Versions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {versions?.length === 0 ? (
                <p className="text-sm text-gray-500">No versions found</p>
              ) : (
                <ul className="space-y-2">
                  {versions?.map((v) => (
                    <li
                      key={v._id}
                      className={`p-2 rounded border ${
                        v.version === workflow?.latestVersion
                          ? 'border-primary-200 bg-primary-50'
                          : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">v{v.version}</span>
                        {v.version === workflow?.latestVersion && (
                          <Badge status="active">Latest</Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        {v.createdAt
                          ? format(new Date(v.createdAt), 'MMM d, yyyy HH:mm')
                          : '-'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Trigger Info */}
          {definition?.trigger && (
            <Card>
              <CardHeader>
                <CardTitle>Trigger</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-gray-500">Type</dt>
                    <dd className="font-medium">{definition.trigger.type}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Metric</dt>
                    <dd className="font-medium">{definition.trigger.metric}</dd>
                  </div>
                  {definition.trigger.condition && (
                    <div>
                      <dt className="text-gray-500">Condition</dt>
                      <dd className="font-medium">
                        {definition.trigger.condition.operator}{' '}
                        {definition.trigger.condition.delta_pct}%
                      </dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Run Modal */}
      {runModalOpen && workflow && (
        <RunWorkflowModal
          workflow={workflow}
          onClose={() => setRunModalOpen(false)}
        />
      )}

      {/* Edit Modal */}
      {editModalOpen && workflow && (
        <EditWorkflowModal
          workflow={workflow}
          onClose={() => setEditModalOpen(false)}
        />
      )}
    </div>
  );
}
