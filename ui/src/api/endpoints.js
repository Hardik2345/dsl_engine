import api from './client';

// Tenant APIs
export const tenantApi = {
  // List all tenants
  list: async () => {
    const { data } = await api.get('/tenants');
    return data.tenants;
  },

  // Get a single tenant
  get: async (tenantId) => {
    const { data } = await api.get(`/tenants/${tenantId}`);
    return data.tenant;
  },

  // Create a new tenant
  create: async (tenantData) => {
    const { data } = await api.post('/tenants', tenantData);
    return data.tenant;
  },

  // Update a tenant
  update: async (tenantId, tenantData) => {
    const { data } = await api.patch(`/tenants/${tenantId}`, tenantData);
    return data.tenant;
  },

  // Delete a tenant
  delete: async (tenantId) => {
    const { data } = await api.delete(`/tenants/${tenantId}`);
    return data;
  },
};

// Workflow APIs
export const workflowApi = {
  // List all workflows for a tenant
  list: async (tenantId, { includeGlobal = true } = {}) => {
    const { data } = await api.get(`/tenants/${tenantId}/workflows`, {
      params: includeGlobal ? { includeGlobal: true } : {}
    });
    return data.workflows;
  },

  // Get a single workflow with its latest version
  get: async (tenantId, workflowId, { includeGlobal = true } = {}) => {
    const { data } = await api.get(`/tenants/${tenantId}/workflows/${workflowId}`, {
      params: includeGlobal ? { includeGlobal: true } : {}
    });
    return data;
  },

  // Create a new workflow
  create: async (tenantId, definition) => {
    const { data } = await api.post(`/tenants/${tenantId}/workflows`, definition);
    return data;
  },

  // Create a new global workflow
  createGlobal: async (definition) => {
    const { data } = await api.post('/workflows/global', definition);
    return data;
  },

  // Create a new version of an existing workflow
  createVersion: async (tenantId, workflowId, definition) => {
    const { data } = await api.post(
      `/tenants/${tenantId}/workflows/${workflowId}/versions`,
      definition
    );
    return data;
  },

  // Create a new version of a global workflow
  createGlobalVersion: async (workflowId, definition) => {
    const { data } = await api.post(
      `/workflows/global/${workflowId}/versions`,
      definition
    );
    return data;
  },

  // List all versions of a workflow
  listVersions: async (tenantId, workflowId, { includeGlobal = true } = {}) => {
    const { data } = await api.get(`/tenants/${tenantId}/workflows/${workflowId}/versions`, {
      params: includeGlobal ? { includeGlobal: true } : {}
    });
    return data.versions;
  },

  // Update workflow metadata
  update: async (tenantId, workflowId, updates) => {
    const { data } = await api.patch(
      `/tenants/${tenantId}/workflows/${workflowId}`,
      updates
    );
    return data.workflow;
  },

  // Update global workflow metadata
  updateGlobal: async (workflowId, updates) => {
    const { data } = await api.patch(`/workflows/global/${workflowId}`, updates);
    return data.workflow;
  },

  // Delete a workflow
  delete: async (tenantId, workflowId) => {
    const { data } = await api.delete(`/tenants/${tenantId}/workflows/${workflowId}`);
    return data;
  },

  // Delete a global workflow
  deleteGlobal: async (workflowId) => {
    const { data } = await api.delete(`/workflows/global/${workflowId}`);
    return data;
  },
};

// Run APIs
export const runApi = {
  // List runs for a workflow
  list: async (tenantId, workflowId) => {
    const { data } = await api.get(`/tenants/${tenantId}/workflows/${workflowId}/runs`);
    return data.runs;
  },

  // Get a single run
  get: async (tenantId, workflowId, runId) => {
    const { data } = await api.get(
      `/tenants/${tenantId}/workflows/${workflowId}/runs/${runId}`
    );
    return data.run;
  },

  // Execute a workflow run
  execute: async (tenantId, workflowId, payload) => {
    const { data } = await api.post(
      `/tenants/${tenantId}/workflows/${workflowId}/runs`,
      payload
    );
    return data;
  },
};

// Insight APIs
export const insightApi = {
  // List insights for a tenant
  list: async (tenantId) => {
    const { data } = await api.get(`/tenants/${tenantId}/insights`);
    return data.insights;
  },
};
