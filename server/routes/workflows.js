const express = require('express');
const crypto = require('crypto');
const Workflow = require('../models/Workflow');
const WorkflowVersion = require('../models/WorkflowVersion');
const Tenant = require('../models/Tenant');
const { validateWorkflowDefinition } = require('../validation/workflowDefinition');

function generateWorkflowId() {
  return `wf_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

const router = express.Router({ mergeParams: true });

// Middleware to validate tenant exists
async function validateTenant(req, res, next) {
  try {
    const { tenantId } = req.params;
    const tenant = await Tenant.findOne({ tenantId, isActive: true });
    if (!tenant) {
      return res.status(404).json({ error: `Tenant '${tenantId}' not found` });
    }
    req.tenant = tenant;
    next();
  } catch (err) {
    next(err);
  }
}

router.use(validateTenant);

router.get('/', async (req, res, next) => {
  try {
     const { tenantId } = req.params;
    const includeGlobal = req.query.includeGlobal === 'true';

    const tenantWorkflows = await Workflow.find({ tenantId }).lean();
    if (!includeGlobal) {
      return res.json({ workflows: tenantWorkflows });
    }

    const globalWorkflows = await Workflow.find({ scope: 'global', tenantId: null }).lean();
    const workflowsById = new Map();

    globalWorkflows.forEach((workflow) => workflowsById.set(workflow.workflowId, workflow));
    tenantWorkflows.forEach((workflow) => workflowsById.set(workflow.workflowId, workflow));

    res.json({ workflows: Array.from(workflowsById.values()) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const definition = req.body;
    
    // Auto-generate workflow_id if not provided
    if (!definition.workflow_id) {
      definition.workflow_id = generateWorkflowId();
    }
    
    const { ok, errors } = validateWorkflowDefinition(definition);
    if (!ok) {
      return res.status(400).json({ errors });
    }

    const workflowId = definition.workflow_id;
    const version = definition.version;

    const workflow = await Workflow.create({
      tenantId,
      scope: 'tenant',
      workflowId,
      name: definition.name || definition.description || workflowId,
      latestVersion: version,
      isActive: true
    });

    await WorkflowVersion.create({
      tenantId,
      scope: 'tenant',
      workflowId,
      version,
      definitionJson: definition
    });

    res.status(201).json({ workflow });
  } catch (err) {
    next(err);
  }
});

router.get('/:workflowId', async (req, res, next) => {
  try {
    const { tenantId, workflowId } = req.params;
    const includeGlobal = req.query.includeGlobal === 'true';

    let workflow = await Workflow.findOne({ tenantId, workflowId }).lean();
    if (!workflow && includeGlobal) {
      workflow = await Workflow.findOne({ scope: 'global', tenantId: null, workflowId }).lean();
    }
    if (!workflow) return res.status(404).json({ error: 'workflow not found' });

    const scope = workflow.scope || 'tenant';
    const scopeClause = scope === 'global'
      ? { scope: 'global' }
      : { $or: [{ scope: 'tenant' }, { scope: { $exists: false } }] };

    const version = await WorkflowVersion.findOne({
      tenantId: workflow.tenantId ?? null,
      workflowId,
      version: workflow.latestVersion,
      ...scopeClause
    }).lean();

    res.json({ workflow, version });
  } catch (err) {
    next(err);
  }
});

router.post('/:workflowId/versions', async (req, res, next) => {
  try {
    const { tenantId, workflowId } = req.params;
    const definition = req.body;
    const { ok, errors } = validateWorkflowDefinition(definition);
    if (!ok) {
      return res.status(400).json({ errors });
    }
    if (definition.workflow_id !== workflowId) {
      return res.status(400).json({ error: 'workflow_id mismatch' });
    }

    const version = definition.version;
    const workflow = await Workflow.findOne({ tenantId, workflowId });
    if (!workflow) return res.status(404).json({ error: 'workflow not found' });

    await WorkflowVersion.create({
      tenantId,
      scope: workflow.scope || 'tenant',
      workflowId,
      version,
      definitionJson: definition
    });

    workflow.latestVersion = version;
    // Keep display name in sync with the latest definition description (if provided)
    if (definition.description) {
      workflow.name = definition.description;
    }
    await workflow.save();

    res.status(201).json({ version });
  } catch (err) {
    next(err);
  }
});

router.get('/:workflowId/versions', async (req, res, next) => {
  try {
    const { tenantId, workflowId } = req.params;
    const includeGlobal = req.query.includeGlobal === 'true';

    let workflow = await Workflow.findOne({ tenantId, workflowId }).lean();
    if (!workflow && includeGlobal) {
      workflow = await Workflow.findOne({ scope: 'global', tenantId: null, workflowId }).lean();
    }
    if (!workflow) return res.status(404).json({ error: 'workflow not found' });

    const scope = workflow.scope || 'tenant';
    const scopeClause = scope === 'global'
      ? { scope: 'global' }
      : { $or: [{ scope: 'tenant' }, { scope: { $exists: false } }] };

    const versions = await WorkflowVersion.find({
      tenantId: workflow.tenantId ?? null,
      workflowId,
      ...scopeClause
    })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ versions });
  } catch (err) {
    next(err);
  }
});

// Update workflow metadata
router.patch('/:workflowId', async (req, res, next) => {
  try {
    const { tenantId, workflowId } = req.params;
    const { name, isActive } = req.body;

    const workflow = await Workflow.findOne({ tenantId, workflowId });
    if (!workflow) return res.status(404).json({ error: 'workflow not found' });

    if (name !== undefined) workflow.name = name;
    if (isActive !== undefined) workflow.isActive = isActive;

    await workflow.save();
    res.json({ workflow });
  } catch (err) {
    next(err);
  }
});

// Delete a workflow and all its versions
router.delete('/:workflowId', async (req, res, next) => {
  try {
    const { tenantId, workflowId } = req.params;

    const workflow = await Workflow.findOne({ tenantId, workflowId });
    if (!workflow) return res.status(404).json({ error: 'workflow not found' });

    // Delete all versions
    await WorkflowVersion.deleteMany({ tenantId, workflowId });

    // Delete the workflow
    await Workflow.deleteOne({ tenantId, workflowId });

    res.json({ message: 'Workflow deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
