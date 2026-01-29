import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tenantApi, workflowApi, runApi, insightApi } from './endpoints';
import { useTenant } from '../context/TenantContext';

// ============ Tenant Hooks ============

export function useTenants() {
  return useQuery({
    queryKey: ['tenants'],
    queryFn: () => tenantApi.list(),
  });
}

export function useCreateTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tenantData) => tenantApi.create(tenantData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
  });
}

export function useDeleteTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tenantId) => tenantApi.delete(tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
  });
}

// ============ Workflow Hooks ============

export function useWorkflows() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['workflows', tenantId],
    queryFn: () => workflowApi.list(tenantId),
  });
}

export function useWorkflow(workflowId) {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['workflow', tenantId, workflowId],
    queryFn: () => workflowApi.get(tenantId, workflowId),
    enabled: !!workflowId,
  });
}

export function useCreateWorkflow() {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (definition) => workflowApi.create(tenantId, definition),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', tenantId] });
    },
  });
}

export function useCreateWorkflowVersion(workflowId) {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (definition) => workflowApi.createVersion(tenantId, workflowId, definition),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', tenantId, workflowId] });
      queryClient.invalidateQueries({ queryKey: ['workflowVersions', tenantId, workflowId] });
    },
  });
}

export function useWorkflowVersions(workflowId) {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['workflowVersions', tenantId, workflowId],
    queryFn: () => workflowApi.listVersions(tenantId, workflowId),
    enabled: !!workflowId,
  });
}

export function useUpdateWorkflow(workflowId) {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updates) => workflowApi.update(tenantId, workflowId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', tenantId, workflowId] });
      queryClient.invalidateQueries({ queryKey: ['workflows', tenantId] });
    },
  });
}

export function useDeleteWorkflow() {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workflowId) => workflowApi.delete(tenantId, workflowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', tenantId] });
    },
  });
}

// ============ Run Hooks ============

export function useWorkflowRuns(workflowId) {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['runs', tenantId, workflowId],
    queryFn: () => runApi.list(tenantId, workflowId),
    enabled: !!workflowId,
  });
}

export function useRun(workflowId, runId) {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['run', tenantId, workflowId, runId],
    queryFn: () => runApi.get(tenantId, workflowId, runId),
    enabled: !!workflowId && !!runId,
  });
}

export function useExecuteWorkflow(workflowId) {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload) => runApi.execute(tenantId, workflowId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs', tenantId, workflowId] });
    },
  });
}

// ============ Insight Hooks ============

export function useInsights() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['insights', tenantId],
    queryFn: () => insightApi.list(tenantId),
  });
}
