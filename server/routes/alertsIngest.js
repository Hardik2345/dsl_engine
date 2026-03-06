const express = require('express');
const { processEnvelope } = require('../../scheduler/app/eventSubscriberService');

const router = express.Router();
const CONFIG_EVENT_TYPES = new Set([
  'alert.config.created',
  'alert.config.updated',
  'alert.config.deleted'
]);
const DEBUG_ALERT_EVENTS = String(process.env.DEBUG_ALERT_EVENTS || '').toLowerCase() === 'true';

function getAuthToken(req) {
  const authHeader = req.headers.authorization || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) return bearerMatch[1];
  return req.headers['x-alerts-ingest-token'] || null;
}

function assertAuthorized(req) {
  const expected = process.env.ALERTS_INGEST_TOKEN;
  if (!expected) return;

  const provided = getAuthToken(req);
  if (!provided || provided !== expected) {
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
}

router.post('/:tenantId/alerts/config-events', async (req, res, next) => {
  try {
    assertAuthorized(req);

    const { tenantId } = req.params;
    const envelope = req.body || {};

    if (!envelope.eventType || !CONFIG_EVENT_TYPES.has(envelope.eventType)) {
      return res.status(400).json({ error: 'eventType must be one of alert.config.created|updated|deleted' });
    }

    if (!envelope.tenantId) {
      return res.status(400).json({ error: 'tenantId is required in body' });
    }

    if (envelope.tenantId !== tenantId) {
      return res.status(400).json({ error: 'tenantId in path and body must match' });
    }

    if (DEBUG_ALERT_EVENTS) {
      console.log('[alert-events] received-http-config-event', {
        eventId: envelope.eventId || null,
        eventType: envelope.eventType,
        tenantId,
        alertId: envelope.alertId || null,
        idempotencyKey: envelope.idempotencyKey || null,
        source: envelope.source || null
      });
    }

    const outcome = await processEnvelope(envelope);

    return res.status(202).json({
      accepted: true,
      duplicate: Boolean(outcome.duplicate),
      status: outcome.status,
      eventId: envelope.eventId || null,
      eventType: envelope.eventType,
      reason: outcome.record?.errorCode || null
    });
  } catch (error) {
    if (error.code === 'INVALID_ENVELOPE' || error.code === 'UNSUPPORTED_EVENT_TYPE') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

module.exports = router;

