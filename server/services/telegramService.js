const DEFAULT_TIMEOUT_MS = 10000;

function normalizeUsers(users = []) {
  return (Array.isArray(users) ? users : [])
    .filter((user) => user && typeof user === 'object')
    .map((user) => ({
      ...(user.username ? { username: String(user.username).trim() } : {}),
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

async function sendTelegram({ title, message, severity = 'info', users, fetchImpl = fetch }) {
  const recipients = validateTelegramUsers(users);
  if (!recipients.ok) {
    return { status: 'failed', provider: 'telegram', error: recipients.error, users: [] };
  }

  const baseUrl = process.env.TELEGRAM_SERVICE_URL;
  const secret = process.env.TELEGRAM_SERVICE_SECRET;
  if (!baseUrl || !secret) {
    return {
      status: 'failed',
      provider: 'telegram',
      users: recipients.users,
      error: 'TELEGRAM_SERVICE_URL and TELEGRAM_SERVICE_SECRET are required'
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/alerts`, {
      method: 'POST',
      headers: {
        'x-shared-secret': secret,
        'x-drains': 'TELEGRAM',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        alert: { title, message, severity },
        users: recipients.users
      }),
      signal: controller.signal
    });

    const responseText = await response.text();
    let responseBody;
    try {
      responseBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseBody = responseText;
    }

    const failedResults = Array.isArray(responseBody?.results)
      ? responseBody.results.filter((result) => result && result.success === false)
      : [];

    if (!response.ok || failedResults.length) {
      return {
        status: failedResults.length && response.ok ? 'partial' : 'failed',
        provider: 'telegram',
        users: recipients.users,
        error: failedResults[0]?.error || responseBody?.error || `Telegram service returned ${response.status}`,
        response: responseBody
      };
    }

    return { status: 'sent', provider: 'telegram', users: recipients.users, response: responseBody };
  } catch (error) {
    return {
      status: 'failed',
      provider: 'telegram',
      users: recipients.users,
      error: error.name === 'AbortError' ? 'Telegram service request timed out' : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendTelegram, validateTelegramUsers };