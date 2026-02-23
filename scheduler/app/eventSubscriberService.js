const ProcessedBrokerEvent = require('../../server/models/ProcessedBrokerEvent');
const { handleAlertConfigEvent } = require('./handlers/handleAlertConfigEvent');
const { handleAlertFiredEvent } = require('./handlers/handleAlertFiredEvent');

const CONFIG_EVENT_TYPES = new Set([
  'alert.config.created',
  'alert.config.updated',
  'alert.config.deleted'
]);

function validateEnvelope(envelope) {
  const required = [
    'eventId',
    'eventType',
    'occurredAt',
    'source',
    'idempotencyKey',
    'tenantId',
    'brandId',
    'alertId'
  ];

  const missing = required.filter((field) => envelope[field] == null || envelope[field] === '');
  if (missing.length) {
    const err = new Error(`invalid broker event: missing ${missing.join(', ')}`);
    err.code = 'INVALID_ENVELOPE';
    throw err;
  }
}

async function claimProcessedEvent(envelope) {
  try {
    const doc = await ProcessedBrokerEvent.create({
      tenantId: envelope.tenantId,
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      alertId: envelope.alertId,
      idempotencyKey: envelope.idempotencyKey,
      occurredAt: new Date(envelope.occurredAt),
      status: 'processing',
      source: envelope.source,
      schemaVersion: envelope.schemaVersion
    });

    return { duplicate: false, record: doc };
  } catch (error) {
    if (error && error.code === 11000) {
      const existing = await ProcessedBrokerEvent.findOne({
        tenantId: envelope.tenantId,
        $or: [{ eventId: envelope.eventId }, { idempotencyKey: envelope.idempotencyKey }]
      }).lean();
      return { duplicate: true, record: existing };
    }
    throw error;
  }
}

async function processEnvelope(envelope) {
  validateEnvelope(envelope);

  const claimed = await claimProcessedEvent(envelope);
  if (claimed.duplicate) {
    return {
      duplicate: true,
      status: 'duplicate',
      record: claimed.record,
      sideEffects: claimed.record?.sideEffects || {}
    };
  }

  const record = claimed.record;

  try {
    let outcome;
    if (CONFIG_EVENT_TYPES.has(envelope.eventType)) {
      outcome = await handleAlertConfigEvent(envelope);
    } else if (envelope.eventType === 'alert.fired') {
      outcome = await handleAlertFiredEvent(envelope);
    } else {
      const err = new Error(`unsupported eventType: ${envelope.eventType}`);
      err.code = 'UNSUPPORTED_EVENT_TYPE';
      throw err;
    }

    record.status = outcome.status || 'applied';
    record.sideEffects = outcome.sideEffects || {};
    await record.save();

    return {
      duplicate: false,
      status: record.status,
      record,
      sideEffects: record.sideEffects
    };
  } catch (error) {
    record.status = 'failed';
    record.errorCode = error.code || 'PROCESSING_ERROR';
    record.errorMessage = error.message;
    await record.save();
    throw error;
  }
}

module.exports = {
  processEnvelope
};
