import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { useFindings } from '../api/hooks';
import { Card, PageSpinner, EmptyState, Badge } from '../components/ui';

const STATUS_OPTIONS = ['active', 'recovering', 'resolved', 'stale', 'snoozed', 'muted'];

export default function FindingsPage() {
  const [status, setStatus] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [severity, setSeverity] = useState('');

  const filters = {
    ...(status ? { status } : {}),
    ...(workflowId ? { workflowId } : {}),
    ...(severity ? { severity } : {}),
  };
  const { data: findings, isLoading, error } = useFindings(filters);

  if (isLoading) return <PageSpinner />;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Error loading findings: {error.message}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Findings</h1>
        <p className="text-gray-500 mt-1">
          Everything the alerting engine currently knows about, tracked as a durable finding.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 border border-gray-300 rounded-lg px-3 text-sm bg-white"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
          placeholder="Filter by workflow ID"
          className="h-9 border border-gray-300 rounded-lg px-3 text-sm"
        />
        <input
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          placeholder="Filter by severity tier"
          className="h-9 border border-gray-300 rounded-lg px-3 text-sm"
        />
      </div>

      {findings?.length === 0 ? (
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title="No findings"
            description="Findings appear here once a workflow with an alert_state node runs and detects something."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {findings?.map((finding) => (
            <Link key={finding.stateKey} to={`/findings/${encodeURIComponent(finding.stateKey)}`}>
              <Card className="p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge status={finding.status}>{finding.status}</Badge>
                      {finding.currentEpisode?.peakSeverityTier && (
                        <Badge status="pending">{finding.currentEpisode.peakSeverityTier}</Badge>
                      )}
                    </div>
                    <div className="font-mono text-xs text-gray-500 break-all">{finding.stateKey}</div>
                    <div className="text-sm text-gray-600 mt-1">Workflow: {finding.workflowId}</div>
                  </div>
                  <div className="text-right text-xs text-gray-400">
                    <div>Last seen</div>
                    <div className="font-medium text-gray-600">
                      {finding.lastSeenAt ? format(new Date(finding.lastSeenAt), 'MMM d, HH:mm') : '-'}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
