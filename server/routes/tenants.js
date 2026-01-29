const express = require('express');
const Tenant = require('../models/Tenant');

const router = express.Router();

// List all tenants
router.get('/', async (req, res, next) => {
  try {
    const tenants = await Tenant.find({ isActive: true }).sort({ name: 1 }).lean();
    res.json({ tenants });
  } catch (err) {
    next(err);
  }
});

// Get a single tenant
router.get('/:tenantId', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const tenant = await Tenant.findOne({ tenantId }).lean();
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

// Create a new tenant
router.post('/', async (req, res, next) => {
  try {
    const { tenantId, name, description, settings } = req.body;

    if (!tenantId || typeof tenantId !== 'string') {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }

    // Check if tenant already exists
    const existing = await Tenant.findOne({ tenantId });
    if (existing) {
      return res.status(409).json({ error: 'Tenant already exists' });
    }

    const tenant = await Tenant.create({
      tenantId: tenantId.toUpperCase(),
      name,
      description,
      settings: settings || {}
    });

    res.status(201).json({ tenant });
  } catch (err) {
    next(err);
  }
});

// Update a tenant
router.patch('/:tenantId', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { name, description, isActive, settings } = req.body;

    const tenant = await Tenant.findOne({ tenantId });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    if (name !== undefined) tenant.name = name;
    if (description !== undefined) tenant.description = description;
    if (isActive !== undefined) tenant.isActive = isActive;
    if (settings !== undefined) tenant.settings = { ...tenant.settings, ...settings };

    await tenant.save();
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

// Delete (deactivate) a tenant
router.delete('/:tenantId', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const tenant = await Tenant.findOne({ tenantId });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    tenant.isActive = false;
    await tenant.save();
    res.json({ message: 'Tenant deactivated' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
