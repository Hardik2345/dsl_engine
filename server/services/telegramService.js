const telegramBot = require('./telegramBot');

// Telegram's hard limit for one message's text.
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

function normalizeUsers(users = []) {
  return (Array.isArray(users) ? users : [])
    .filter((user) => user && typeof user === 'object')
    .map((user) => ({
      ...(user.username ? { username: String(user.username).trim().replace(/^@/, '') } : {}),
      ...(user.telegramChatId ? { telegramChatId: String(user.telegramChatId).trim() } : {})
    }))
    .filter((user) => user.username || user.telegramChatId);
}

function validateTelegramUsers(users = []) {
  const normalized = normalizeUsers(users);
  if (!normalized.length) {
    return { ok: false, error: 'at least one username or telegramChatId is required' };
  }
  return { ok: true, users: normalized };
}

// "[SEVERITY] title" on the first line, then the message body -- the same parts the
// standalone message service used, one per line instead of run together, and cut
// to Telegram's per-message limit.
function formatTelegramMessage({ title, message, severity }) {
  const header = [severity ? `[${String(severity).toUpperCase()}]` : '', title || ''].filter(Boolean).join(' ');
  const text = [header, message || ''].filter(Boolean).join('\n').trim();
  if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return text;
  return `${text.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 1)}…`;
}

/**
 * Sends one alert to Telegram users, in-process through the engine's own bot
 * (ported from the standalone message service's POST /alerts). Users are given by
 * `username` (resolved through links made with GET /telegram/link) or a raw
 * `telegramChatId`. Delivery is per user: one failure doesn't stop the others.
 *
 * Returns { status: 'sent' | 'partial' | 'failed', provider, users, results, error }.
 * `deps` lets tests swap the Telegram and database calls.
 */
async function sendTelegram({ title, message, severity = 'info', users, deps = telegramBot }) {
  const recipients = validateTelegramUsers(users);
  if (!recipients.ok) {
    return { status: 'failed', provider: 'telegram', error: recipients.error, users: [] };
  }
  if (!deps.isTelegramConfigured()) {
    return {
      status: 'failed',
      provider: 'telegram',
      users: recipients.users,
      error: 'TELEGRAM_BOT_TOKEN is not configured'
    };
  }

  const text = formatTelegramMessage({ title, message, severity });
  if (!text) {
    return { status: 'failed', provider: 'telegram', users: recipients.users, error: 'alert has no title or message' };
  }

  try {
    const resolved = await deps.resolveChatIds(recipients.users);
    const sendable = resolved.filter((user) => user.telegramChatId);
    const unresolved = resolved
      .filter((user) => !user.telegramChatId)
      .map((user) => ({
        username: user.username,
        success: false,
        error: `no linked Telegram chat for "${user.username}" (send them a "Copy Telegram link" link and have them press Start)`
      }));

    const sent = sendable.length ? await deps.sendToUsers(sendable, text) : [];
    const results = [...sent, ...unresolved];
    const succeeded = results.filter((result) => result.success).length;

    let status = 'failed';
    if (succeeded === results.length) status = 'sent';
    else if (succeeded > 0) status = 'partial';

    return {
      status,
      provider: 'telegram',
      users: recipients.users,
      results,
      ...(status === 'sent' ? {} : { error: results.find((result) => !result.success)?.error || 'telegram delivery failed' })
    };
  } catch (error) {
    return {
      status: 'failed',
      provider: 'telegram',
      users: recipients.users,
      error: error?.message || 'telegram delivery failed'
    };
  }
}

module.exports = { sendTelegram, validateTelegramUsers, formatTelegramMessage, TELEGRAM_MAX_MESSAGE_LENGTH };
