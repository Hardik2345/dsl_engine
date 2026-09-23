const test = require('node:test');
const assert = require('node:assert/strict');

const EmailNode = require('../nodes/EmailNode');

function context(transitions) {
  return { alertStates: { transitions }, scratch: {} };
}

test('for_each declares one notification intent per notify-worthy item and calls no sender', async () => {
  let senderCalled = false;
  const transitions = [
    { stateKey: 'a', transition: 'new', notify: true, finding: { label: 'Product A' } },
    { stateKey: 'b', transition: 'none', notify: false, finding: { label: 'Product B' } },
    { stateKey: 'c', transition: 'resolved', notify: true, finding: { label: 'Product C' } },
  ];

  const result = await EmailNode(
    { id: 'send_finding_email', type: 'email', format: 'finding', for_each: 'alertStates.transitions', to: ['ops@example.com'], subject: 'ignored', next: 'done' },
    context(transitions),
    { emailSender: async () => { senderCalled = true; return { status: 'sent' }; } }
  );

  assert.equal(result.status, 'pass');
  assert.equal(result.delta.notifications.length, 2);
  assert.deepEqual(result.delta.notifications.map((n) => n.intentId), ['a', 'c']);
  assert.equal(result.next, 'done');
  assert.equal(senderCalled, false);
});

test('for_each with an empty array declares no intents and does not fail', async () => {
  const result = await EmailNode(
    { id: 'send_finding_email', type: 'email', format: 'finding', for_each: 'alertStates.transitions', to: ['ops@example.com'], subject: 'ignored' },
    context([]),
    {}
  );
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.delta.notifications, []);
});

test('a node without for_each still uses the legacy single-send path', async () => {
  let senderCalled = false;
  const ctx = { scratch: { finalInsight: { summary: 'Ready', details: [] } } };
  const result = await EmailNode(
    { id: 'mail', type: 'email', format: 'insight', to: ['ops@example.com'], subject: 'Report', template: { insightSource: 'scratch.finalInsight' } },
    ctx,
    { emailSender: async () => { senderCalled = true; return { status: 'sent' }; } }
  );
  assert.equal(result.status, 'pass');
  assert.equal(senderCalled, true);
});
