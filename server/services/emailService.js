const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 25;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Set once per run by workflowExecutionService.js via runNotificationContext(),
// so sendEmail can dedupe/cooldown without any change to the InsightNode/EmailNode
// call sites, which destructure `sendEmail` from this module at require-time --
// patching module.exports.sendEmail from outside this file after that point would
// never reach those already-bound references. The gating logic must live here,
// inside the module's own top-level `sendEmail` binding.
const notificationContext = new AsyncLocalStorage();

function runNotificationContext(context, fn) {
  return notificationContext.run(context, fn);
}

function hashContent(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload || {})).digest('hex');
}

function normalizeRecipients(recipients = []) {
  return (Array.isArray(recipients) ? recipients : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function validateRecipients(recipients = []) {
  const normalized = normalizeRecipients(recipients);
  if (!normalized.length) {
    return { ok: false, error: 'at least one recipient is required' };
  }
  if (normalized.length > MAX_RECIPIENTS) {
    return { ok: false, error: `recipient count exceeds limit of ${MAX_RECIPIENTS}` };
  }
  const invalid = normalized.filter((email) => !EMAIL_REGEX.test(email));
  if (invalid.length) {
    return { ok: false, error: `invalid email recipient(s): ${invalid.join(', ')}` };
  }
  return { ok: true, recipients: normalized };
}

function createTransport() {
  const user = process.env.GMAIL_USER || process.env.SMTP_USER;
  const pass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;

  if (!user) throw new Error('GMAIL_USER is not configured');
  if (!pass) throw new Error('GMAIL_APP_PASSWORD is not configured');

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass
    }
  });
}

async function deliverEmailRaw({ to, subject, html, text }) {
  const recipientsResult = validateRecipients(to);
  if (!recipientsResult.ok) {
    return {
      status: 'failed',
      provider: 'smtp',
      to: normalizeRecipients(to),
      error: recipientsResult.error
    };
  }

  const from = process.env.EMAIL_FROM;

  if (!from) {
    return {
      status: 'failed',
      provider: 'smtp',
      to: recipientsResult.recipients,
      error: 'EMAIL_FROM is not configured'
    };
  }

  try {
    const transport = createTransport();
    const delivery = await transport.sendMail({
      from,
      to: recipientsResult.recipients.join(', '),
      subject,
      html,
      text: text || ''
    });

    return {
      status: 'sent',
      provider: 'smtp',
      to: recipientsResult.recipients,
      subject,
      messageId: delivery.messageId || null
    };
  } catch (error) {
    return {
      status: 'failed',
      provider: 'smtp',
      to: recipientsResult.recipients,
      subject,
      error: error.message
    };
  }
}

// Mongoose-backed ledger adapter used in production. Tests inject a plain-object
// fake implementing this same shape (findRecentDuplicate/insertPending/finalize),
// matching this repo's existing dependency-injection test style (see EmailNode's
// runtime.emailSender) rather than requiring a real MongoDB connection.
function createMongoLedgerAdapter() {
  const NotificationLedger = require('../models/NotificationLedger');

  return {
    async findRecentDuplicate({ tenantId, workflowId, contentHash }) {
      if (!tenantId || !workflowId || !contentHash) return null;
      return NotificationLedger.findOne({
        tenantId,
        workflowId,
        contentHash,
        status: 'sent',
        sentAt: { $gte: new Date(Date.now() - COOLDOWN_MS) }
      }).sort({ sentAt: -1 }).lean();
    },
    async recordSuppressed({ tenantId, dedupeKey, workflowId, runId, recipients, subject, contentHash, suppressedReason }) {
      await NotificationLedger.create({
        tenantId, dedupeKey, workflowId, runId,
        channel: 'email', recipients, subject, contentHash,
        status: 'suppressed', suppressedReason
      });
    },
    async insertPending({ tenantId, dedupeKey, workflowId, runId, recipients, subject, contentHash }) {
      try {
        const row = await NotificationLedger.create({
          tenantId, dedupeKey, workflowId, runId,
          channel: 'email', recipients, subject, contentHash,
          status: 'pending'
        });
        return { ok: true, row };
      } catch (error) {
        if (error && error.code === 11000) return { ok: false, reason: 'duplicate' };
        throw error;
      }
    },
    async finalize(row, delivery) {
      row.status = delivery.status === 'sent' ? 'sent' : 'failed';
      row.provider = delivery.provider;
      row.messageId = delivery.messageId || undefined;
      row.lastError = delivery.error || undefined;
      row.sentAt = delivery.status === 'sent' ? new Date() : undefined;
      await row.save();
    }
  };
}

// Factory so Phase 0's dedupe/cooldown decision logic is testable with a fake ledger
// adapter and a fake raw sender, with no real DB and no mocking library -- the same
// dependency-injection idiom already used by EmailNode's runtime.emailSender.
function createSendEmail({ ledger = createMongoLedgerAdapter(), rawSender = deliverEmailRaw } = {}) {
  return async function sendEmail({ to, subject, html, text }) {
    const runCtx = notificationContext.getStore() || {};
    const { tenantId, workflowId, runId, alwaysSend } = runCtx;
    const contentHash = hashContent({ to, subject, html });

    // No run context available (e.g. called outside executeRun, such as a script or
    // a test that doesn't set one up) -- fall back to sending directly, ungated.
    if (!tenantId || !workflowId || !runId) {
      return rawSender({ to, subject, html, text });
    }

    const dedupeKey = crypto.createHash('sha1').update(`${runId}|${contentHash}`).digest('hex');
    const recipients = normalizeRecipients(to);

    // "Send Daily Insight" workflows must go out every scheduled run even if the
    // content happens to repeat (e.g. a quiet weekend with identical zero-order
    // numbers two days running) -- skip the content-hash cooldown for them. The
    // per-run duplicate-key insert just below still applies, so a genuine retry
    // of the same run still can't double-send.
    if (!alwaysSend) {
      const duplicateInWindow = await ledger.findRecentDuplicate({ tenantId, workflowId, contentHash });
      if (duplicateInWindow) {
        await ledger.recordSuppressed({
          tenantId,
          dedupeKey: `${dedupeKey}|cooldown|${Date.now()}`,
          workflowId, runId, recipients, subject, contentHash,
          suppressedReason: 'cooldown'
        });
        return { status: 'skipped', reason: 'cooldown', provider: 'smtp', to: recipients, subject };
      }
    }

    const inserted = await ledger.insertPending({ tenantId, dedupeKey, workflowId, runId, recipients, subject, contentHash });
    if (!inserted.ok) {
      // Another attempt (e.g. a retried run) already owns this exact send.
      return { status: 'suppressed', reason: 'duplicate', provider: 'smtp', to: recipients, subject };
    }

    const delivery = await rawSender({ to, subject, html, text });
    await ledger.finalize(inserted.row, delivery);
    return delivery;
  };
}

const sendEmail = createSendEmail();

module.exports = {
  sendEmail,
  validateRecipients,
  runNotificationContext,
  createSendEmail,
};
