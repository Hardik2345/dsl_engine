const crypto = require('crypto');
const AlertShadow = require('../../../server/models/AlertShadow');

function hashPayload(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload || {})).digest('hex');
}

function normalizeConfigPayload(envelope) {
  const payload = envelope.payload || {};
  return {
    tenantId: envelope.tenantId,
    brandId: envelope.brandId,
    alertId: envelope.alertId,
    name: payload.name || payload.alertName,
    alertType: payload.alertType,
    scope: payload.scope || 'single',
    status: payload.status || (payload.isActive ? 'active' : 'inactive'),
    metricName: payload.metricName,
    metricType: payload.metricType,
    thresholdType: payload.thresholdType,
    thresholdValue: payload.thresholdValue,
    criticalThreshold: payload.criticalThreshold,
    severity: payload.severity,
    cooldownMinutes: payload.cooldownMinutes,
    sourceUpdatedAt: payload.updatedAt ? new Date(payload.updatedAt) : undefined,
    configVersion: Number.isFinite(Number(payload.version)) ? Number(payload.version) : undefined,
    isDeleted: envelope.eventType === 'alert.config.deleted',
    lastConfigEventId: envelope.eventId,
    payloadHash: hashPayload(payload)
  };
}

function isStale(existing, incoming) {
  if (!existing) return false;

  if (incoming.configVersion != null && existing.configVersion != null) {
    return incoming.configVersion < existing.configVersion;
  }

  if (incoming.sourceUpdatedAt && existing.sourceUpdatedAt) {
    return incoming.sourceUpdatedAt < existing.sourceUpdatedAt;
  }

  return false;
}

async function handleAlertConfigEvent(envelope) {
  const normalized = normalizeConfigPayload(envelope);
  const existing = await AlertShadow.findOne({
    tenantId: normalized.tenantId,
    alertId: normalized.alertId
  });

  if (isStale(existing, normalized)) {
    return { status: 'stale', sideEffects: { shadowUpdated: false } };
  }

  const update = {
    $set: {
      brandId: normalized.brandId,
      name: normalized.name,
      alertType: normalized.alertType,
      scope: normalized.scope,
      status: normalized.status,
      metricName: normalized.metricName,
      metricType: normalized.metricType,
      thresholdType: normalized.thresholdType,
      thresholdValue: normalized.thresholdValue,
      criticalThreshold: normalized.criticalThreshold,
      severity: normalized.severity,
      cooldownMinutes: normalized.cooldownMinutes,
      sourceUpdatedAt: normalized.sourceUpdatedAt,
      configVersion: normalized.configVersion,
      isDeleted: normalized.isDeleted,
      lastConfigEventId: normalized.lastConfigEventId,
      payloadHash: normalized.payloadHash
    },
    $setOnInsert: {
      tenantId: normalized.tenantId,
      alertId: normalized.alertId
    }
  };

  await AlertShadow.updateOne(
    { tenantId: normalized.tenantId, alertId: normalized.alertId },
    update,
    { upsert: true }
  );

  return {
    status: 'applied',
    sideEffects: { shadowUpdated: true, alertId: normalized.alertId }
  };
}

module.exports = { handleAlertConfigEvent };
