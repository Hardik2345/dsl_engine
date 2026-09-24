const test = require('node:test');
const assert = require('node:assert/strict');
const MessagingNode = require('../nodes/MessagingNode');
const { sendTelegram } = require('../server/services/telegramService');

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

test('telegram service sends the curl-equivalent headers and payload', async () => {
  const originalUrl = process.env.TELEGRAM_SERVICE_URL;
  const originalSecret = process.env.TELEGRAM_SERVICE_SECRET;
  process.env.TELEGRAM_SERVICE_URL = 'http://telegram-service.test';
  process.env.TELEGRAM_SERVICE_SECRET = 'test-secret';

  let request;
  try {
    const result = await sendTelegram({
      title: 'CVR drop',
      message: 'Conversion rate dropped',
      severity: 'critical',
      users: [{ username: 'real-user' }],
      fetchImpl: async (url, options) => {
        request = { url, options };
        return new Response(JSON.stringify({ delivered: 1 }), { status: 200 });
      }
    });

    assert.equal(result.status, 'sent');
    assert.equal(request.url, 'http://telegram-service.test/alerts');
    assert.equal(request.options.headers['x-shared-secret'], 'test-secret');
    assert.equal(request.options.headers['x-drains'], 'TELEGRAM');
    assert.deepEqual(JSON.parse(request.options.body), {
      alert: { title: 'CVR drop', message: 'Conversion rate dropped', severity: 'critical' },
      users: [{ username: 'real-user' }]
    });
  } finally {
    if (originalUrl === undefined) delete process.env.TELEGRAM_SERVICE_URL;
    else process.env.TELEGRAM_SERVICE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.TELEGRAM_SERVICE_SECRET;
    else process.env.TELEGRAM_SERVICE_SECRET = originalSecret;
  }
});