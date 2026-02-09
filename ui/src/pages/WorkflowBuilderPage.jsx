import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { WorkflowBuilder, PageSpinner } from '../components';
import { useWorkflow, useCreateWorkflow, useCreateWorkflowVersion } from '../api/hooks';
import toast from 'react-hot-toast';

const NEW_WORKFLOW_TEMPLATE = {
  workflow_id: 'new_workflow',
  workflow_type: 'root_cause_analysis',
  description: 'New visual workflow',
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
      id: 'start',
      type: 'validation',
      checks: [
        { field: 'sessions', condition: 'current > 0' },
      ],
      next: 'analysis',
    },
    {
        id: 'analysis',
        type: 'metric_compare',
        metrics: ['cvr'],
        next: 'insight'
    },
    {
        id: 'insight',
        type: 'insight',
        template: 'Analysis complete'
    }
  ],
};

export default function WorkflowBuilderPage() {
  const { workflowId } = useParams();
  const navigate = useNavigate();
  const isEditing = !!workflowId;

  // Hooks for fetching (if editing)
  const { data: workflowData, isLoading, error } = useWorkflow(workflowId);

  // Hooks for mutations
  const createWorkflow = useCreateWorkflow();
  const createVersion = useCreateWorkflowVersion(workflowId);

  if (isEditing && isLoading) return <PageSpinner />;
  
  if (isEditing && error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Error loading workflow: {error.message}</p>
        <button onClick={() => navigate('/workflows')} className="text-blue-500 underline mt-4">
          Go back
        </button>
      </div>
    );
  }

  const initialData = isEditing 
        ? (workflowData?.version?.definitionJson || NEW_WORKFLOW_TEMPLATE)
        : NEW_WORKFLOW_TEMPLATE;

  const handleSave = async (workflowJson) => {
    try {
      if (isEditing) {
        // Creating a new version
        // We probably want to auto-increment version number if not handled by backend or user
        const currentVersion = workflowData?.version?.definitionJson?.version || '1.0';
        const versionParts = currentVersion.split('.');
        const newVersion = `${versionParts[0]}.${parseInt(versionParts[1] || 0) + 1}`;
        
        workflowJson.version = newVersion;
        // Ensure workflow_id matches
        workflowJson.workflow_id = workflowId;

        await createVersion.mutateAsync(workflowJson);
        toast.success(`New version ${newVersion} saved successfully`);
        navigate(`/workflows/${workflowId}`);
      } else {
        // Creating new workflow
        if(workflowJson.workflow_id === 'new_workflow') {
             // If user didn't change ID, maybe prompt or just accept? 
             // Ideally WorkflowBuilder handles metadata editing like ID.
             // We'll trust what's in the JSON for now.
             // But if it conflicts, backend will throw.
        }
        await createWorkflow.mutateAsync(workflowJson);
        toast.success('Workflow created successfully');
        navigate(`/workflows/${workflowJson.workflow_id}`);
      }
    } catch (err) {
      console.error(err);
      const errorMsg = err.response?.data?.error 
        || (err.response?.data?.errors ? err.response.data.errors.join(', ') : null)
        || 'Failed to save workflow';
      toast.error(errorMsg);
    }
  };

  return (
    <div className="h-screen w-full bg-white">
      <WorkflowBuilder 
        initialData={initialData}
        onSave={handleSave}
        onBack={() => navigate(isEditing ? `/workflows/${workflowId}` : '/workflows')}
        isEditing={isEditing}
      />
    </div>
  );
}
