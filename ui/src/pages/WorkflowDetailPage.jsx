import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  GitCommit,
  Clock,
  Edit2,
  Trash2,
  Layout,
  CalendarPlus,
  Pause,
  PlayCircle,
  RefreshCw,
  AlertTriangle,
  Activity
} from 'lucide-react';
import {
  useWorkflow,
  useWorkflowVersions,
  useDeleteWorkflow,
  useWorkflowSchedules,
  useCreateWorkflowSchedule,
  usePauseWorkflowSchedule,
  useResumeWorkflowSchedule,
  useDeleteWorkflowSchedule,
  useReplayMissedTriggers,
  useSchedulerQueue,
  useTriggerEvents,
  useUnmatchedAlerts
} from '../api/hooks';
import { Button, Badge, Card, CardHeader, CardContent, CardTitle, PageSpinner } from '../components/ui';
import { format } from 'date-fns';
import { useState } from 'react';
import RunWorkflowModal from '../components/RunWorkflowModal';
import EditWorkflowModal from '../components/EditWorkflowModal';
import toast from 'react-hot-toast';

const SCHEDULE_PRESETS = {
  every_5m: {
    label: 'Every 5 minutes',
    cronExpr: '*/5 * * * *',
    description: 'Runs every 5 minutes'
  },
  every_15m: {
    label: 'Every 15 minutes',
    cronExpr: '*/15 * * * *',
    description: 'Runs every 15 minutes'
  },
  hourly: {
    label: 'Hourly',
    cronExpr: '0 * * * *',
    description: 'Runs at minute 0 of every hour'
  }
};

export default function WorkflowDetailPage() {
  const navigate = useNavigate();
  const { workflowId } = useParams();

  const { data, isLoading, error } = useWorkflow(workflowId);
  const { data: versions } = useWorkflowVersions(workflowId);
  const { data: schedules = [], isLoading: schedulesLoading } = useWorkflowSchedules(workflowId);
  const { data: queue } = useSchedulerQueue();
  const { data: triggerEvents = [] } = useTriggerEvents();
  const { data: unmatchedAlerts = [] } = useUnmatchedAlerts();

  const deleteWorkflow = useDeleteWorkflow();
  const createSchedule = useCreateWorkflowSchedule(workflowId);
  const pauseSchedule = usePauseWorkflowSchedule(workflowId);
  const resumeSchedule = useResumeWorkflowSchedule(workflowId);
  const deleteSchedule = useDeleteWorkflowSchedule(workflowId);
  const replayMissed = useReplayMissedTriggers(workflowId);

  const [runModalOpen, setRunModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    name: '',
    overlapPolicy: 'queue_one_pending'
  });
  const [scheduleMode, setScheduleMode] = useState('simple');
  const [selectedPreset, setSelectedPreset] = useState('every_15m');
  const [customCronExpr, setCustomCronExpr] = useState('*/15 * * * *');

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

  const handleCreateSchedule = async (e) => {
    e.preventDefault();

    try {
      const cronExpr = scheduleMode === 'simple'
        ? SCHEDULE_PRESETS[selectedPreset].cronExpr
        : customCronExpr.trim();

      await createSchedule.mutateAsync({
        name: scheduleForm.name.trim() || undefined,
        cronExpr,
        overlapPolicy: scheduleForm.overlapPolicy,
        timezone: 'UTC'
      });
      toast.success('Schedule created');
      setScheduleForm((prev) => ({ ...prev, name: '' }));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create schedule');
    }
  };

  const handlePauseSchedule = async (scheduleId) => {
    try {
      await pauseSchedule.mutateAsync(scheduleId);
      toast.success('Schedule paused');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to pause schedule');
    }
  };

  const handleResumeSchedule = async (scheduleId) => {
    try {
      await resumeSchedule.mutateAsync(scheduleId);
      toast.success('Schedule resumed');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to resume schedule');
    }
  };

  const handleReplayMissed = async (scheduleId) => {
    try {
      const result = await replayMissed.mutateAsync(scheduleId);
      toast.success(`Replayed ${result.replayedCount || 0} missed triggers`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to replay missed triggers');
    }
  };

  const handleDeleteSchedule = async (scheduleId, scheduleName) => {
    const label = scheduleName || 'this schedule';
    if (!confirm(`Delete ${label}? This removes the schedule and its missed-trigger records.`)) {
      return;
    }

    try {
      await deleteSchedule.mutateAsync(scheduleId);
      toast.success('Schedule deleted');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete schedule');
    }
  };

  const workflowEvents = triggerEvents.filter((event) => event.matchedWorkflowId === workflowId);
  const workflowUnmatched = unmatchedAlerts.filter((alert) => alert.alertType === definition?.trigger?.alertType);

  return (
    <div>
      <Link
        to="/workflows"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Workflows
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{workflow?.name || workflowId}</h1>
          <p className="text-xs text-gray-400 font-mono mt-1">{workflowId}</p>
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
        <div className="lg:col-span-2 space-y-6">
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

          <Card>
            <CardHeader>
              <CardTitle>Scheduler Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="grid grid-cols-1 md:grid-cols-12 gap-2.5" onSubmit={handleCreateSchedule}>
                <div className="md:col-span-3">
                  <label className="block text-xs text-gray-500 mb-1">Name</label>
                  <input
                    type="text"
                    value={scheduleForm.name}
                    onChange={(e) => setScheduleForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full h-10 border border-gray-300 rounded-lg px-3 text-sm"
                    placeholder="optional"
                  />
                </div>
                <div className="md:col-span-4">
                  <label className="block text-xs text-gray-500 mb-1">Schedule Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setScheduleMode('simple')}
                      className={`w-full h-10 px-3 rounded-lg border text-sm whitespace-nowrap ${
                        scheduleMode === 'simple'
                          ? 'border-primary-300 bg-primary-50 text-primary-700'
                          : 'border-gray-300 bg-white text-gray-700'
                      }`}
                    >
                      Simple
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduleMode('advanced')}
                      className={`w-full h-10 px-3 rounded-lg border text-sm whitespace-nowrap ${
                        scheduleMode === 'advanced'
                          ? 'border-primary-300 bg-primary-50 text-primary-700'
                          : 'border-gray-300 bg-white text-gray-700'
                      }`}
                    >
                      Advanced
                    </button>
                  </div>
                </div>
                <div className="md:col-span-3">
                  <label className="block text-xs text-gray-500 mb-1">Overlap Policy</label>
                  <select
                    value={scheduleForm.overlapPolicy}
                    onChange={(e) => setScheduleForm((prev) => ({ ...prev, overlapPolicy: e.target.value }))}
                    className="w-full h-10 border border-gray-300 rounded-lg px-3 text-sm"
                  >
                    <option value="queue_one_pending">Queue one pending</option>
                    <option value="skip_if_running">Skip if running</option>
                    <option value="allow_parallel">Allow parallel</option>
                  </select>
                </div>
                <div className="md:col-span-2 flex items-end">
                  <Button
                    type="submit"
                    size="sm"
                    className="w-full h-10 whitespace-nowrap"
                    loading={createSchedule.isPending}
                  >
                    <CalendarPlus className="w-4 h-4 mr-2" />
                    Add Schedule
                  </Button>
                </div>

                {scheduleMode === 'simple' ? (
                  <div className="md:col-span-12">
                    <label className="block text-xs text-gray-500 mb-1">When to run</label>
                    <select
                      value={selectedPreset}
                      onChange={(e) => setSelectedPreset(e.target.value)}
                      className="w-full h-12 border border-gray-300 rounded-lg px-3 text-sm"
                    >
                      {Object.entries(SCHEDULE_PRESETS).map(([key, item]) => (
                        <option key={key} value={key}>{item.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-2">
                      {SCHEDULE_PRESETS[selectedPreset].description} ({SCHEDULE_PRESETS[selectedPreset].cronExpr} UTC)
                    </p>
                  </div>
                ) : (
                  <div className="md:col-span-12">
                    <label className="block text-xs text-gray-500 mb-1">Cron (UTC)</label>
                    <input
                      type="text"
                      value={customCronExpr}
                      onChange={(e) => setCustomCronExpr(e.target.value)}
                      className="w-full h-12 border border-gray-300 rounded-lg px-3 text-sm font-mono"
                      placeholder="*/15 * * * *"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-2">
                      Format: minute hour day-of-month month day-of-week.
                      Example: <span className="font-mono">0 9 * * 1-5</span> runs weekdays at 09:00 UTC.
                    </p>
                  </div>
                )}
              </form>

              <div className="mt-4 space-y-3">
                {schedulesLoading ? (
                  <p className="text-sm text-gray-500">Loading schedules...</p>
                ) : schedules.length === 0 ? (
                  <p className="text-sm text-gray-500">No schedules configured.</p>
                ) : (
                  schedules.map((schedule) => (
                    <div
                      key={schedule._id}
                      className="border border-gray-200 rounded-lg p-3 bg-gray-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-gray-900">{schedule.name || 'Untitled Schedule'}</p>
                          <p className="text-xs text-gray-500 font-mono">{schedule.cronExpr} (UTC)</p>
                        </div>
                        <Badge status={schedule.isActive ? 'active' : 'inactive'}>
                          {schedule.isActive ? 'Active' : 'Paused'}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-500 mt-2">
                        <p>
                          Next Run: {schedule.nextRunAt ? format(new Date(schedule.nextRunAt), 'MMM d, yyyy HH:mm') : '-'}
                        </p>
                        <p>
                          Last Trigger: {schedule.lastTriggeredAt ? format(new Date(schedule.lastTriggeredAt), 'MMM d, yyyy HH:mm') : '-'}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2 mt-3">
                        {schedule.isActive ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handlePauseSchedule(schedule._id)}
                            loading={pauseSchedule.isPending}
                          >
                            <Pause className="w-3 h-3 mr-1" />
                            Pause
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleResumeSchedule(schedule._id)}
                            loading={resumeSchedule.isPending}
                          >
                            <PlayCircle className="w-3 h-3 mr-1" />
                            Resume
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleReplayMissed(schedule._id)}
                          loading={replayMissed.isPending}
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Replay Missed
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDeleteSchedule(schedule._id, schedule.name)}
                          loading={deleteSchedule.isPending}
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

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

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <GitCommit className="w-4 h-4 mr-2" />
                Versions
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-64 overflow-y-auto">
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Activity className="w-4 h-4 mr-2" />
                Scheduler Queue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-gray-500">Queued</dt>
                  <dd className="font-medium">{queue?.queued ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Running</dt>
                  <dd className="font-medium">{queue?.running ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Deferred</dt>
                  <dd className="font-medium">{queue?.deferred ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Retrying</dt>
                  <dd className="font-medium">{queue?.retrying ?? 0}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-gray-500">Dead Letter</dt>
                  <dd className="font-medium">{queue?.deadLetter ?? 0}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

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
                    <dt className="text-gray-500">Alert Type</dt>
                    <dd className="font-medium">{definition.trigger.alertType || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Brand Scope</dt>
                    <dd className="font-medium">{definition.trigger.brandScope || '-'}</dd>
                  </div>
                  {Array.isArray(definition.trigger.brandIds) && definition.trigger.brandIds.length > 0 && (
                    <div>
                      <dt className="text-gray-500">Brands</dt>
                      <dd className="font-medium break-all">{definition.trigger.brandIds.join(', ')}</dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <AlertTriangle className="w-4 h-4 mr-2" />
                Trigger Observability
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <p className="text-gray-600">
                  Matched events for this workflow: <span className="font-medium">{workflowEvents.length}</span>
                </p>
                <p className="text-gray-600">
                  Unmatched alerts for this trigger type: <span className="font-medium">{workflowUnmatched.length}</span>
                </p>
                {workflowEvents[0] && (
                  <p className="text-xs text-gray-500">
                    Latest matched event: {format(new Date(workflowEvents[0].createdAt), 'MMM d, yyyy HH:mm:ss')}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {runModalOpen && workflow && (
        <RunWorkflowModal
          workflow={workflow}
          onClose={() => setRunModalOpen(false)}
        />
      )}

      {editModalOpen && workflow && (
        <EditWorkflowModal
          workflow={workflow}
          onClose={() => setEditModalOpen(false)}
        />
      )}
    </div>
  );
}
