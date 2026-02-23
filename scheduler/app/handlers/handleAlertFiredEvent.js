const AlertShadow = require('../../../server/models/AlertShadow');
const { ingestEventTrigger } = require('../schedulerService');

function toSchedulerEventBody(envelope) {
  const payload = envelope.payload || {};
  return {
    brand: envelope.tenantId,
    alertType: payload.alertType,
    idempotencyKey: envelope.idempotencyKey,
    occurredAt: envelope.occurredAt,
    payload: {
      ...payload,
      metric: payload.metricName || payload.metric || 'cvr',
      alertId: envelope.alertId,
      brandId: envelope.brandId,
      scope: payload.scope || 'single'
    }
  };
}

async function handleAlertFiredEvent(envelope) {
  const payload = envelope.payload || {};

  await AlertShadow.updateOne(
    { tenantId: envelope.tenantId, alertId: envelope.alertId },
    {
      $set: {
        brandId: envelope.brandId,
        name: payload.name || payload.alertName,
        alertType: payload.alertType,
        scope: payload.scope || 'single',
        status: payload.status || 'active',
        isDeleted: false,
        lastFiredAt: envelope.occurredAt ? new Date(envelope.occurredAt) : new Date()
      },
      $setOnInsert: {
        tenantId: envelope.tenantId,
        alertId: envelope.alertId
      }
    },
    { upsert: true }
  );

  const result = await ingestEventTrigger({
    tenantId: envelope.tenantId,
    body: toSchedulerEventBody(envelope)
  });

  if (result.duplicate) {
    return { status: 'duplicate', sideEffects: { duplicate: true, runId: result.run?._id || null } };
  }

  if (result.unmatched) {
    return { status: 'applied', sideEffects: { unmatched: true } };
  }

  if (result.skipped) {
    return { status: 'applied', sideEffects: { skipped: true, reason: result.triggerEvent?.reason } };
  }

  return {
    status: 'applied',
    sideEffects: {
      runId: result.run?._id || null,
      matchedWorkflowId: result.triggerEvent?.matchedWorkflowId || null
    }
  };
}

module.exports = { handleAlertFiredEvent };
