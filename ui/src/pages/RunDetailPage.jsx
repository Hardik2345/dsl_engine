import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useRun } from '../api/hooks';
import { Badge, Card, CardHeader, CardContent, CardTitle, PageSpinner } from '../components/ui';
import { useState } from 'react';

export default function RunDetailPage() {
  const { workflowId, runId } = useParams();
  const { data: run, isLoading, error } = useRun(workflowId, runId);
  const [expandedNodes, setExpandedNodes] = useState({});

  if (isLoading) return <PageSpinner />;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Error loading run: {error.message}</p>
      </div>
    );
  }

  const toggleNode = (nodeId) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  };

  const getStatusIcon = (status) => {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-yellow-500" />;
    }
  };

  const getDuration = () => {
    if (!run?.startedAt || !run?.finishedAt) return '-';
    const start = new Date(run.startedAt);
    const end = new Date(run.finishedAt);
    const diffMs = end - start;
    if (diffMs < 1000) return `${diffMs}ms`;
    if (diffMs < 60000) return `${(diffMs / 1000).toFixed(2)}s`;
    return `${(diffMs / 60000).toFixed(2)}m`;
  };
  const truncate = (text, max = 200) => {
    if (!text || typeof text !== 'string') return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
  };
  const renderRankedList = (text) => {
    if (!text || typeof text !== 'string') return null;
    const lines = text.split('\n').filter(Boolean);
    if (!lines.length || !lines.every((line) => /^\d+\.\s+/.test(line))) return null;

    return (
      <ol className="list-decimal list-inside space-y-1">
        {lines.map((line, idx) => {
          const content = line.replace(/^\d+\.\s+/, '');
          const parts = content.split(' | ').map((part) => part.trim()).filter(Boolean);
          const [title, ...rest] = parts;
          return (
            <li key={idx}>
              <span>{truncate(title, 140)}</span>
              {rest.length > 0 && (
                <ul className="list-disc list-inside ml-4 mt-0.5 space-y-0.5">
                  {rest.map((item, itemIdx) => (
                    <li key={itemIdx}>{truncate(item, 160)}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    );
  };

  return (
    <div>
      {/* Back Link */}
      <Link
        to={`/workflows/${workflowId}/runs`}
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Runs
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            {getStatusIcon(run?.status)}
            Run Details
          </h1>
          <p className="text-gray-500 mt-1 font-mono text-sm">{runId}</p>
        </div>
        <Badge status={run?.status?.toLowerCase()}>
          {run?.status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Summary Card */}
          <Card>
            <CardHeader>
              <CardTitle>Execution Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <dt className="text-sm text-gray-500">Workflow</dt>
                  <dd className="font-medium">{workflowId}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Version</dt>
                  <dd className="font-medium">v{run?.version}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Duration</dt>
                  <dd className="font-medium">{getDuration()}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Started</dt>
                  <dd className="font-medium">
                    {run?.startedAt
                      ? format(new Date(run.startedAt), 'HH:mm:ss')
                      : '-'}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Execution Trace */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Clock className="w-4 h-4 mr-2" />
                Execution Trace ({run?.executionTrace?.length || 0} steps)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {run?.executionTrace?.length === 0 ? (
                <p className="text-sm text-gray-500">No execution trace available</p>
              ) : (
                <div className="space-y-2">
                  {run?.executionTrace?.map((step, idx) => (
                    <div
                      key={idx}
                      className="flex items-center p-3 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <span className="w-6 h-6 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-xs font-medium mr-3">
                        {idx + 1}
                      </span>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">
                          {typeof step === 'string' ? step : step.nodeId || step.id}
                        </p>
                        {step.type && (
                          <p className="text-sm text-gray-500">{step.type}</p>
                        )}
                      </div>
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Node Outputs */}
          <Card>
            <CardHeader>
              <CardTitle>Node Outputs ({run?.nodeOutputs?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {run?.nodeOutputs?.length === 0 ? (
                <p className="text-sm text-gray-500">No node outputs available</p>
              ) : (
                <div className="space-y-3">
                  {run?.nodeOutputs?.map((output, idx) => (
                    <div key={idx} className="border border-gray-200 rounded-lg">
                      <button
                        onClick={() => toggleNode(`output-${idx}`)}
                        className="w-full flex items-center justify-between p-3 hover:bg-gray-50"
                      >
                        <span className="font-medium">
                          {output.nodeId || `Node ${idx + 1}`}
                        </span>
                        <span className="text-sm text-gray-500">
                          {expandedNodes[`output-${idx}`] ? '▼' : '▶'}
                        </span>
                      </button>
                      {expandedNodes[`output-${idx}`] && (
                        <div className="p-3 border-t border-gray-200 bg-gray-50">
                          <pre className="text-xs overflow-auto max-h-64">
                            {JSON.stringify(output, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Metrics */}
          {run?.metrics && Object.keys(run.metrics).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2">
                  {Object.entries(run.metrics).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-4">
                      <dt className="text-sm text-gray-500">{key}</dt>
                      <dd className="font-medium text-sm text-right break-words">
                        {typeof value === 'number'
                          ? value.toFixed(2)
                          : renderRankedList(value) || truncate(String(value), 200)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}

          {/* Context - Meta */}
          {run?.context?.meta && (
            <Card>
              <CardHeader>
                <CardTitle>Context Meta</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  {Object.entries(run.context.meta).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-gray-500">{key}</dt>
                      <dd className="font-medium break-all">
                        {typeof value === 'object'
                          ? JSON.stringify(value)
                          : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}

          {/* Final Insight */}
          {run?.context?.scratch?.finalInsight && (
            <Card className="border-primary-200 bg-primary-50">
              <CardHeader>
                <CardTitle className="text-primary-800">💡 Insight</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-primary-900 font-medium mb-3">
                  {truncate(run.context.scratch.finalInsight.summary, 220)}
                </div>
                
                {run.context.scratch.finalInsight.details && run.context.scratch.finalInsight.details.length > 0 && (
                   <ul className="list-disc list-inside space-y-1 mb-3">
                      {run.context.scratch.finalInsight.details.map((detail, idx) => {
                        if (typeof detail !== 'string') {
                          return (
                            <li key={idx} className="text-xs text-primary-800">
                              {String(detail)}
                            </li>
                          );
                        }

                        const lines = detail.split('\n').filter(Boolean);
                        if (lines.length <= 1) {
                          return (
                            <li key={idx} className="text-xs text-primary-800">
                              {truncate(detail, 260)}
                            </li>
                          );
                        }

                        const [header, ...items] = lines;
                        const listItems = items.filter((line) => /^\d+\.\s+/.test(line));
                        const fallbackItems = items.filter((line) => !/^\d+\.\s+/.test(line));

                        return (
                          <li key={idx} className="text-xs text-primary-800">
                            <span>{truncate(header, 200)}</span>
                            {listItems.length > 0 && (
                              <ol className="list-decimal list-inside mt-1 space-y-1 ml-4">
                                {listItems.map((line, lineIdx) => {
                                  const content = line.replace(/^\d+\.\s+/, '');
                                  const parts = content.split(' | ').map((part) => part.trim()).filter(Boolean);
                                  const [title, ...rest] = parts;
                                  return (
                                    <li key={lineIdx}>
                                      <span>{truncate(title, 140)}</span>
                                      {rest.length > 0 && (
                                        <ul className="list-disc list-inside ml-4 mt-0.5 space-y-0.5">
                                          {rest.map((item, itemIdx) => (
                                            <li key={itemIdx}>{truncate(item, 160)}</li>
                                          ))}
                                        </ul>
                                      )}
                                    </li>
                                  );
                                })}
                              </ol>
                            )}
                            {fallbackItems.length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {fallbackItems.map((line, lineIdx) => (
                                  <div key={lineIdx}>{line}</div>
                                ))}
                              </div>
                            )}
                          </li>
                        );
                      })}
                   </ul>
                )}

                {run.context.scratch.finalInsight.confidence && (
                  <div className="pt-2 border-t border-primary-200/50 flex justify-between items-center">
                    <span className="text-xs text-primary-700">Confidence Score</span>
                    <span className="text-xs font-bold text-primary-800">
                        {(run.context.scratch.finalInsight.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
