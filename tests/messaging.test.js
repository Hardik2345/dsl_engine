const test = require('node:test');
const assert = require('node:assert/strict');
const MessagingNode = require('../nodes/MessagingNode');
const { sendTelegram, formatTelegramMessage, TELEGRAM_MAX_MESSAGE_LENGTH } = require('../server/services/telegramService');

function context() {
  return {
    meta: { tenantId: 'tenant_a', brandName: 'Brand A', window: 'today', baselineWindow: 'yesterday' },
    metrics: {},
    scratch: { finalInsight: { summary: 'CVR dropped', details: ['Landing page conversion is down'] } }
  };
}

test('messaging node sends both enabled channels independently', async () => {
  const calls = [];
  const result = await MessagingNode({
    id: 'notify',
    type: 'messaging',
    channels: { email: true, telegram: true },
    format: 'insight',
    subject: 'Brand A alert',
    template: { insightSource: 'scratch.finalInsight' },
    email: { to: ['ops@example.com'] },
    telegram: { users: [{ username: 'real-user' }], severity: 'critical' }
  }, context(), {
    emailSender: async (payload) => {
      calls.push({ channel: 'email', payload });
      return { status: 'sent', provider: 'smtp' };
    },
    telegramSender: async (payload) => {
      calls.push({ channel: 'telegram', payload });
      return { status: 'sent', provider: 'telegram' };
    }
  });

  assert.equal(result.status, 'pass');
  assert.deepEqual(calls.map((call) => call.channel), ['email', 'telegram']);
  assert.deepEqual(calls[1].payload.users, [{ username: 'real-user' }]);
  assert.equal(calls[1].payload.severity, 'critical');
});

// In-process Telegram delivery (ported from the standalone message service). The
// bot API and the linked-users lookup are swapped for fakes via `deps`.
function fakeTelegram({ linked = {}, failChatIds = [], configured = true } = {}) {
  const sent = [];
  return {
    sent,
    isTelegramConfigured: () => configured,
    resolveChatIds: async (users) => users.map((user) => ({
      username: user.username,
      telegramChatId: user.telegramChatId || linked[user.username] || null
    })),
    sendToUsers: async (users, text) => users.map((user) => {
      sent.push({ chatId: user.telegramChatId, text });
      return failChatIds.includes(user.telegramChatId)
        ? { telegramChatId: user.telegramChatId, username: user.username, success: false, error: 'Forbidden: bot was blocked by the user' }
        : { telegramChatId: user.telegramChatId, username: user.username, success: true };
    })
  };
}

test('telegram: linked usernames and raw chat ids both receive the formatted alert', async () => {
  const deps = fakeTelegram({ linked: { ops_lead: '111' } });
  const result = await sendTelegram({
    title: 'CVR drop', message: 'Conversion rate dropped', severity: 'critical',
    users: [{ username: '@ops_lead' }, { telegramChatId: '222' }], deps
  });

  assert.equal(result.status, 'sent');
  assert.deepEqual(deps.sent.map((m) => m.chatId), ['111', '222']);
  assert.equal(deps.sent[0].text, ['[CRITICAL] CVR drop', 'Conversion rate dropped'].join('\n'));
});

test('telegram: an unlinked username is reported, and the others still get it (partial)', async () => {
  const deps = fakeTelegram({ linked: { ops_lead: '111' } });
  const result = await sendTelegram({ title: 'CVR drop', message: 'm', users: [{ username: 'ops_lead' }, { username: 'nobody' }], deps });

  assert.equal(result.status, 'partial');
  assert.equal(deps.sent.length, 1);
  assert.match(result.error, /no linked Telegram chat for "nobody"/);
});

test('telegram: every recipient failing is failed, not partial', async () => {
  const deps = fakeTelegram({ linked: { ops_lead: '111' }, failChatIds: ['111'] });
  const result = await sendTelegram({ title: 'CVR drop', message: 'm', users: [{ username: 'ops_lead' }], deps });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /blocked/);
});

test('telegram: a missing bot token fails clearly without trying to send', async () => {
  const deps = fakeTelegram({ configured: false });
  const result = await sendTelegram({ title: 'CVR drop', message: 'm', users: [{ username: 'ops_lead' }], deps });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'TELEGRAM_BOT_TOKEN is not configured');
  assert.equal(deps.sent.length, 0);
});

test('telegram: messages are cut to the 4096-character limit', () => {
  const text = formatTelegramMessage({ title: 'T', message: 'x'.repeat(10000), severity: 'info' });
  assert.equal(text.length, TELEGRAM_MAX_MESSAGE_LENGTH);
  assert.ok(text.startsWith(['[INFO] T', 'xxx'].join('\n')));
  assert.ok(text.endsWith('…'));
});
