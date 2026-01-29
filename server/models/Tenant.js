const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String },
    isActive: { type: Boolean, default: true },
    settings: {
      currency: { type: String, default: 'USD' },
      timezone: { type: String, default: 'UTC' }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tenant', TenantSchema);
