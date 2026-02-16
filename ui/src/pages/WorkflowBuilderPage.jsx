import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { WorkflowBuilder, PageSpinner } from '../components';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkflow, useCreateGlobalWorkflow, useCreateWorkflowVersion, useCreateGlobalWorkflowVersion, useTenants } from '../api/hooks';
import { workflowApi } from '../api/endpoints';
import { useTenant } from '../context/TenantContext';
import toast from 'react-hot-toast';

const NEW_WORKFLOW_TEMPLATE = {
  name: 'New Workflow',
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
  const queryClient = useQueryClient();
  const { tenantId } = useTenant();
  const { data: tenants = [], isLoading: tenantsLoading } = useTenants();
  const createGlobalWorkflow = useCreateGlobalWorkflow();
  const [scope, setScope] = useState('single'); // 'single' | 'multiple' | 'global'
  const [selectedTenantIds, setSelectedTenantIds] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Hooks for fetching (if editing)
  const { data: workflowData, isLoading, error } = useWorkflow(workflowId);

  // Determine if editing a global workflow
  const isGlobalWorkflow = workflowData?.workflow?.scope === 'global';

  // Hooks for mutations
  const createVersion = useCreateWorkflowVersion(workflowId);
  const createGlobalVersion = useCreateGlobalWorkflowVersion(workflowId);

  const initialData = isEditing 
        ? {
            ...(workflowData?.version?.definitionJson || NEW_WORKFLOW_TEMPLATE),
            name: workflowData?.workflow?.name || workflowData?.version?.definitionJson?.name
          }
        : NEW_WORKFLOW_TEMPLATE;

  const tenantOptions = useMemo(() => {
    const list = Array.isArray(tenants) ? tenants : [];
    return list
      .filter((tenant) => tenant?.tenantId)
      .map((tenant) => tenant.tenantId)
      .sort();
  }, [tenants]);

  const resolvedTenantIds = useMemo(() => {
    if (scope === 'multiple') return selectedTenantIds;
    return tenantId ? [tenantId] : [];
  }, [scope, selectedTenantIds, tenantId]);

  const toggleTenantSelection = (targetTenantId) => {
    setSelectedTenantIds((prev) => {
      if (prev.includes(targetTenantId)) {
        return prev.filter((id) => id !== targetTenantId);
      }
      return [...prev, targetTenantId];
    });
  };

  const handleScopeChange = (nextScope) => {
    setScope(nextScope);
    if (nextScope === 'multiple' && selectedTenantIds.length === 0 && tenantId) {
      setSelectedTenantIds([tenantId]);
    }
  };

  const createWorkflowsForTenants = async (definition, tenantIds) => {
    if (!tenantIds.length) {
      toast.error('Select at least one tenant');
      return null;
    }

    setIsSubmitting(true);

    try {
      const results = await Promise.allSettled(
        tenantIds.map((targetTenantId) => workflowApi.create(targetTenantId, definition))
      );

      const successes = results
        .map((result, index) => ({ result, tenantId: tenantIds[index] }))
        .filter((entry) => entry.result.status === 'fulfilled');
      const failures = results
        .map((result, index) => ({ result, tenantId: tenantIds[index] }))
        .filter((entry) => entry.result.status === 'rejected');

      successes.forEach(({ tenantId: successTenantId }) => {
        queryClient.invalidateQueries({ queryKey: ['workflows', successTenantId] });
      });

      if (failures.length) {
        const failedTenantList = failures.map((entry) => entry.tenantId).join(', ');
        toast.error(`Failed to create workflow for: ${failedTenantList}`);
      }

      if (!successes.length) {
        return null;
      }

      if (tenantIds.length === 1 && tenantIds[0] === tenantId) {
        return successes[0].result.value;
      }

      const successCount = successes.length;
      const successLabel = successCount === 1 ? 'tenant' : 'tenant(s)';
      toast.success(`Workflow created for ${successCount} ${successLabel}`);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const createGlobalWorkflowDefinition = async (definition) => {
    setIsSubmitting(true);

    try {
      const result = await createGlobalWorkflow.mutateAsync(definition);
      return result;
    } finally {
      setIsSubmitting(false);
    }
  };

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

        // Use appropriate mutation based on workflow scope
        if (isGlobalWorkflow) {
          await createGlobalVersion.mutateAsync(workflowJson);
        } else {
          await createVersion.mutateAsync(workflowJson);
        }
        toast.success(`New version ${newVersion} saved successfully`);
        navigate(`/workflows/${workflowId}`);
      } else {
        // Creating new workflow - workflow_id will be auto-generated by server
        // Remove any placeholder workflow_id to let server generate
        delete workflowJson.workflow_id;
        
        const result = scope === 'global'
          ? await createGlobalWorkflowDefinition(workflowJson)
          : await createWorkflowsForTenants(workflowJson, resolvedTenantIds);
        if (result?.workflow?.workflowId) {
          toast.success('Workflow created successfully');
          navigate(`/workflows/${result.workflow.workflowId}`);
        } else if (result === null) {
          navigate('/workflows');
        }
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
      {isEditing && isLoading ? (
        <PageSpinner />
      ) : isEditing && error ? (
        <div className="text-center py-12">
          <p className="text-red-500">Error loading workflow: {error.message}</p>
          <button onClick={() => navigate('/workflows')} className="text-blue-500 underline mt-4">
            Go back
          </button>
        </div>
      ) : (
        <WorkflowBuilder 
          initialData={initialData}
          onSave={handleSave}
          onBack={() => navigate(isEditing ? `/workflows/${workflowId}` : '/workflows')}
          isEditing={isEditing}
          scope={scope}
          onScopeChange={handleScopeChange}
          tenantOptions={tenantOptions}
          selectedTenantIds={selectedTenantIds}
          onToggleTenant={toggleTenantSelection}
          tenantsLoading={tenantsLoading}
          currentTenantId={tenantId}
          isSaving={isSubmitting}
        />
      )}
    </div>
  );
}
