const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String },
    isActive: { type: Boolean, default: true },
    settings: {
      currency: { type: String, default: 'USD' },
      timezone: { type: String, default: 'UTC' },
      emailBranding: {
        displayName: { type: String },
        logoUrl: { type: String },
        tagline: { type: String },
        primaryColor: { type: String },
        footerText: { type: String }
      },
      // design doc §8.6. Reuses settings.timezone above for quiet-hours evaluation
      // rather than duplicating a timezone field here.
      notifications: {
        quietHours: {
          start: { type: String },
          end: { type: String },
          severityBypass: { type: [String], default: ['critical'] }
        },
        maxEmailsPerDay: { type: Number },
        digestHour: { type: Number },
        defaultRecipients: { type: [String], default: [] }
      }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tenant', TenantSchema);
