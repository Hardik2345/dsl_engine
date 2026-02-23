import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  tenantApi,
  workflowApi,
  runApi,
  insightApi,
  scheduleApi,
  schedulerApi,
  triggerApi
} from './endpoints';
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
    queryFn: () => workflowApi.list(tenantId, { includeGlobal: true }),
  });
}

export function useWorkflow(workflowId) {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['workflow', tenantId, workflowId],
    queryFn: () => workflowApi.get(tenantId, workflowId, { includeGlobal: true }),
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

export function useCreateGlobalWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (definition) => workflowApi.createGlobal(definition),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}

export function useCreateGlobalWorkflowVersion(workflowId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (definition) => workflowApi.createGlobalVersion(workflowId, definition),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow'] });
      queryClient.invalidateQueries({ queryKey: ['workflowVersions'] });
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
    queryFn: () => workflowApi.listVersions(tenantId, workflowId, { includeGlobal: true }),
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

export function useUpdateGlobalWorkflow(workflowId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updates) => workflowApi.updateGlobal(workflowId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow'] });
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
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

export function useDeleteGlobalWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workflowId) => workflowApi.deleteGlobal(workflowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
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
    mutationFn: (input = {}) => {
      if (input && input.payload !== undefined) {
        return runApi.execute(tenantId, workflowId, input.payload, { mode: input.mode });
      }
      return runApi.execute(tenantId, workflowId, input, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs', tenantId, workflowId] });
    },
  });
}

// ============ Scheduler Hooks ============

export function useWorkflowSchedules(workflowId) {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['schedules', tenantId, workflowId],
    queryFn: () => scheduleApi.list(tenantId, workflowId),
    enabled: !!workflowId
  });
}

export function useCreateWorkflowSchedule(workflowId) {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload) => scheduleApi.create(tenantId, workflowId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', tenantId, workflowId] });
      queryClient.invalidateQueries({ queryKey: ['schedulerQueue', tenantId] });
    }
  });
}

export function useUpdateWorkflowSchedule(workflowId) {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ scheduleId, payload }) =>
      scheduleApi.update(tenantId, workflowId, scheduleId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', tenantId, workflowId] });
    }
  });
}

export function usePauseWorkflowSchedule(workflowId) {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scheduleId) => scheduleApi.pause(tenantId, workflowId, scheduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', tenantId, workflowId] });
    }
  });
}

export function useResumeWorkflowSchedule(workflowId) {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scheduleId) => scheduleApi.resume(tenantId, workflowId, scheduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', tenantId, workflowId] });
    }
  });
}

export function useReplayMissedTriggers(workflowId) {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scheduleId) => scheduleApi.replayMissed(tenantId, workflowId, scheduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', tenantId, workflowId] });
      queryClient.invalidateQueries({ queryKey: ['runs', tenantId, workflowId] });
      queryClient.invalidateQueries({ queryKey: ['schedulerQueue', tenantId] });
    }
  });
}

export function useSchedulerQueue() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['schedulerQueue', tenantId],
    queryFn: () => schedulerApi.queue(tenantId)
  });
}

export function useTriggerEvents() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['triggerEvents', tenantId],
    queryFn: () => triggerApi.listEvents(tenantId)
  });
}

export function useUnmatchedAlerts() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['unmatchedAlerts', tenantId],
    queryFn: () => triggerApi.listUnmatched(tenantId)
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
