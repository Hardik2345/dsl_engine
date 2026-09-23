import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import {
  useFinding, useAckFinding, useSnoozeFinding, useMuteFinding, useUnmuteFinding, useResolveFinding,
} from '../api/hooks';
import { Badge, Card, CardHeader, CardContent, CardTitle, Button, PageSpinner } from '../components/ui';

function formatDate(value) {
  return value ? format(new Date(value), 'MMM d, yyyy HH:mm') : '-';
}

export default function FindingDetailPage() {
  const { stateKey } = useParams();
  const { data, isLoading, error } = useFinding(stateKey);
  const ack = useAckFinding();
  const snooze = useSnoozeFinding();
  const mute = useMuteFinding();
  const unmute = useUnmuteFinding();
  const resolve = useResolveFinding();

  if (isLoading) return <PageSpinner />;
  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Error loading finding: {error.message}</p>
      </div>
    );
  }

  const finding = data?.finding;
  const observations = data?.observations || [];
  if (!finding) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Finding not found.</p>
      </div>
    );
  }

  const runMutation = async (mutation, successMessage) => {
    try {
      await mutation.mutateAsync({ stateKey });
      toast.success(successMessage);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    }
  };

  return (
    <div>
      <Link to="/findings" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Findings
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <Badge status={finding.status}>{finding.status}</Badge>
            {finding.workflowId}
          </h1>
          <p className="text-gray-500 mt-1 font-mono text-sm break-all">{stateKey}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>Observation Timeline</CardTitle></CardHeader>
            <CardContent>
              {observations.length === 0 ? (
                <p className="text-sm text-gray-500">No observations recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {observations.map((obs) => (
                    <div key={obs._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                      <div>
                        <span className="font-medium">{obs.transition || (obs.breaching ? 'breaching' : 'clean')}</span>
                        {obs.conclusive === false && <span className="ml-2 text-amber-600 text-xs">inconclusive</span>}
                      </div>
                      <div className="text-gray-500">{formatDate(obs.observedAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-gray-500">First seen</dt><dd>{formatDate(finding.firstSeenAt)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Last seen</dt><dd>{formatDate(finding.lastSeenAt)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Episode</dt><dd>{finding.episodeCount ?? 1}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Severity</dt><dd>{finding.currentEpisode?.peakSeverityTier || 'n/a'}</dd></div>
                {finding.mutedAt && <div className="flex justify-between"><dt className="text-gray-500">Muted by</dt><dd>{finding.mutedBy}</dd></div>}
                {finding.snoozedUntil && <div className="flex justify-between"><dt className="text-gray-500">Snoozed until</dt><dd>{formatDate(finding.snoozedUntil)}</dd></div>}
                {finding.ackedAt && <div className="flex justify-between"><dt className="text-gray-500">Acked by</dt><dd>{finding.ackedBy}</dd></div>}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                <Button size="sm" variant="secondary" onClick={() => runMutation(ack, 'Acknowledged')} loading={ack.isPending}>Ack</Button>
                <Button size="sm" variant="secondary" onClick={() => runMutation(snooze, 'Snoozed for 24h')} loading={snooze.isPending}>Snooze 24h</Button>
                {finding.status === 'muted' ? (
                  <Button size="sm" variant="secondary" onClick={() => runMutation(unmute, 'Un-muted')} loading={unmute.isPending}>Unmute</Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => runMutation(mute, 'Muted')} loading={mute.isPending}>Mute</Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => runMutation(resolve, 'Marked resolved')} loading={resolve.isPending}>Resolve</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
