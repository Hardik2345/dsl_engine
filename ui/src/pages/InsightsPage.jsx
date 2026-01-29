import { Lightbulb } from 'lucide-react';
import { useInsights } from '../api/hooks';
import { useTenant } from '../context/TenantContext';
import { Card, PageSpinner, EmptyState, Badge } from '../components/ui';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

export default function InsightsPage() {
  const { tenantId } = useTenant();
  const { data: insights, isLoading, error } = useInsights();

  if (isLoading) return <PageSpinner />;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Error loading insights: {error.message}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Insights</h1>
        <p className="text-gray-500 mt-1">
          View all generated insights for {tenantId}
        </p>
      </div>

      {/* Insights List */}
      {insights?.length === 0 ? (
        <Card>
          <EmptyState
            icon={Lightbulb}
            title="No insights yet"
            description="Insights will appear here after running workflows."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {insights?.map((insight) => (
            <Card key={insight._id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb className="w-5 h-5 text-yellow-500" />
                    <h3 className="font-semibold text-gray-900">
                      {insight.summary}
                    </h3>
                  </div>
                  {insight.details?.length > 0 && (
                    <ul className="text-sm text-gray-600 ml-7 space-y-1">
                      {insight.details.slice(0, 3).map((detail, idx) => (
                        <li key={idx}>• {detail}</li>
                      ))}
                      {insight.details.length > 3 && (
                        <li className="text-gray-400">
                          +{insight.details.length - 3} more...
                        </li>
                      )}
                    </ul>
                  )}
                </div>
                <div className="text-right text-sm">
                  {insight.confidence && (
                    <Badge status={insight.confidence > 0.7 ? 'success' : 'pending'}>
                      {(insight.confidence * 100).toFixed(0)}% confidence
                    </Badge>
                  )}
                  <p className="text-gray-400 mt-2">
                    {insight.createdAt
                      ? format(new Date(insight.createdAt), 'MMM d, HH:mm')
                      : '-'}
                  </p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-4 text-sm text-gray-500">
                <span>Workflow: <Link to={`/workflows/${insight.workflowId}`} className="text-primary-600 hover:underline">{insight.workflowId}</Link></span>
                {insight.runId && (
                  <span>
                    Run: <Link to={`/workflows/${insight.workflowId}/runs/${insight.runId}`} className="text-primary-600 hover:underline font-mono">{insight.runId.slice(-8)}</Link>
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
