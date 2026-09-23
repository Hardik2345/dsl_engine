const express = require('express');
const AlertState = require('../models/AlertState');
const AlertObservation = require('../models/AlertObservation');
const { verifyActionToken } = require('../lib/signedActionLink');
const { renderConfirmationPage, renderConfirmedPage, renderErrorPage } = require('../lib/actionConfirmationPage');

const router = express.Router({ mergeParams: true });

const ALLOWED_STATUSES = new Set(['absent', 'new', 'active', 'recovering', 'resolved', 'stale', 'snoozed', 'muted']);

// design §13.1. No auth guard here -- matches every existing route in this app
// (none has server-side auth today); see docs/state-based-alerting-design.md and
// the Phase 4 plan's locked decision #1.
router.get('/', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { status, workflowId, severity } = req.query;

    const query = { tenantId };
    if (status) {
      if (!ALLOWED_STATUSES.has(status)) return res.status(400).json({ error: `status must be one of ${Array.from(ALLOWED_STATUSES).join(', ')}` });
      query.status = status;
    }
    if (workflowId) query.workflowId = workflowId;
    if (severity) query['currentEpisode.peakSeverityTier'] = severity;

    const findings = await AlertState.find(query).sort({ lastSeenAt: -1 }).limit(200).lean();
    res.json({ findings });
  } catch (error) {
    next(error);
  }
});

router.get('/:stateKey', async (req, res, next) => {
  try {
    const { tenantId, stateKey } = req.params;
    const finding = await AlertState.findOne({ tenantId, stateKey }).lean();
    if (!finding) return res.status(404).json({ error: 'finding not found' });

    const observations = await AlertObservation.find({ tenantId, stateKey }).sort({ observedAt: -1 }).limit(100).lean();
    res.json({ finding, observations });
  } catch (error) {
    next(error);
  }
});

// Internal action handlers shared by the authenticated routes below and the
// signed-link confirmation POST -- one implementation, two ways in.
async function applyAck(tenantId, stateKey, { actorEmail } = {}) {
  const finding = await AlertState.findOneAndUpdate(
    { tenantId, stateKey },
    { $set: { ackedAt: new Date(), ackedBy: actorEmail || 'unknown' } },
    { new: true }
  ).lean();
  if (!finding) { const e = new Error('finding not found'); e.status = 404; throw e; }
  return finding;
}

async function applySnooze(tenantId, stateKey, { until, duration, actorEmail } = {}) {
  const snoozedUntil = until ? new Date(until) : new Date(Date.now() + (Number(duration) || 24 * 60 * 60 * 1000));
  if (Number.isNaN(snoozedUntil.getTime())) { const e = new Error('invalid until/duration'); e.status = 400; throw e; }
  const finding = await AlertState.findOneAndUpdate(
    { tenantId, stateKey },
    { $set: { status: 'snoozed', snoozedUntil, snoozedBy: actorEmail || 'unknown' } },
    { new: true }
  ).lean();
  if (!finding) { const e = new Error('finding not found'); e.status = 404; throw e; }
  return finding;
}

async function applyMute(tenantId, stateKey, { actorEmail } = {}) {
  const finding = await AlertState.findOneAndUpdate(
    { tenantId, stateKey },
    { $set: { status: 'muted', mutedAt: new Date(), mutedBy: actorEmail || 'unknown' } },
    { new: true }
  ).lean();
  if (!finding) { const e = new Error('finding not found'); e.status = 404; throw e; }
  return finding;
}

async function applyUnmute(tenantId, stateKey) {
  // Restores to 'active' -- the only status that makes sense for something being
  // un-muted (a resolved/absent finding wouldn't have been muted in the first
  // place; the next real observation will move it on from here normally).
  const finding = await AlertState.findOneAndUpdate(
    { tenantId, stateKey },
    { $set: { status: 'active', mutedAt: null, mutedBy: null } },
    { new: true }
  ).lean();
  if (!finding) { const e = new Error('finding not found'); e.status = 404; throw e; }
  return finding;
}

async function applyResolve(tenantId, stateKey) {
  const now = new Date();
  const finding = await AlertState.findOneAndUpdate(
    { tenantId, stateKey },
    { $set: { status: 'resolved', resolvedAt: now, retentionExpiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000) } },
    { new: true }
  ).lean();
  if (!finding) { const e = new Error('finding not found'); e.status = 404; throw e; }
  return finding;
}

const ACTION_HANDLERS = { ack: applyAck, snooze: applySnooze, mute: applyMute, unmute: applyUnmute, resolve: applyResolve };

router.post('/:stateKey/ack', async (req, res, next) => {
  try {
    const finding = await applyAck(req.params.tenantId, req.params.stateKey, req.body || {});
    res.json({ finding });
  } catch (error) { next(error); }
});

router.post('/:stateKey/snooze', async (req, res, next) => {
  try {
    const finding = await applySnooze(req.params.tenantId, req.params.stateKey, req.body || {});
    res.json({ finding });
  } catch (error) { next(error); }
});

router.post('/:stateKey/mute', async (req, res, next) => {
  try {
    const finding = await applyMute(req.params.tenantId, req.params.stateKey, req.body || {});
    res.json({ finding });
  } catch (error) { next(error); }
});

router.post('/:stateKey/unmute', async (req, res, next) => {
  try {
    const finding = await applyUnmute(req.params.tenantId, req.params.stateKey);
    res.json({ finding });
  } catch (error) { next(error); }
});

router.post('/:stateKey/resolve', async (req, res, next) => {
  try {
    const finding = await applyResolve(req.params.tenantId, req.params.stateKey);
    res.json({ finding });
  } catch (error) { next(error); }
});

// Signed action links (design §13.2). GET only ever renders a confirmation form --
// state never changes on a bare GET, since mail scanners/prefetchers can trigger
// GETs without any user intent. The POST is what actually applies the action, and
// it re-verifies the token itself rather than trusting the query string alone.
router.get('/:stateKey/confirm', async (req, res) => {
  const { tenantId, stateKey } = req.params;
  const { token, action } = req.query;
  try {
    const payload = verifyActionToken(token);
    if (payload.tenantId !== tenantId || payload.stateKey !== stateKey || payload.action !== action) {
      return res.status(401).type('html').send(renderErrorPage('This link is invalid.'));
    }
    if (!ACTION_HANDLERS[action]) return res.status(400).type('html').send(renderErrorPage('Unknown action.'));
    res.type('html').send(renderConfirmationPage({ tenantId, stateKey, action, token }));
  } catch (error) {
    res.status(error.status || 401).type('html').send(renderErrorPage('This link is invalid or has expired.'));
  }
});

router.post('/:stateKey/confirm', async (req, res) => {
  const { tenantId, stateKey } = req.params;
  const { token, action } = req.body || {};
  try {
    const payload = verifyActionToken(token);
    if (payload.tenantId !== tenantId || payload.stateKey !== stateKey || payload.action !== action) {
      return res.status(401).type('html').send(renderErrorPage('This link is invalid.'));
    }
    const handler = ACTION_HANDLERS[action];
    if (!handler) return res.status(400).type('html').send(renderErrorPage('Unknown action.'));

    await handler(tenantId, stateKey, { actorEmail: 'email-link' });
    res.type('html').send(renderConfirmedPage({ action }));
  } catch (error) {
    res.status(error.status || 401).type('html').send(renderErrorPage('This link is invalid or has expired.'));
  }
});

module.exports = router;
