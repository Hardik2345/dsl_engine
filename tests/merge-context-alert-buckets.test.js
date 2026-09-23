const test = require('node:test');
const assert = require('node:assert/strict');

const mergeContext = require('../engine/MergeContext');

function freshContext() {
  return { filters: [], metrics: {}, rootCausePath: [], scratch: {}, breakdowns: {} };
}

test('meta remains immutable even with the new buckets present', () => {
  const context = freshContext();
  assert.throws(() => mergeContext(context, { meta: { tenantId: 'x' } }), /meta is immutable/);
});

test('alertStates is replaced by the last writer, same rule as breakdowns', () => {
  const context = freshContext();
  mergeContext(context, { alertStates: { transitions: [{ stateKey: 'a' }] } });
  mergeContext(context, { alertStates: { transitions: [{ stateKey: 'b' }] } });
  assert.deepEqual(context.alertStates, { transitions: [{ stateKey: 'b' }] });
});

test('notifications accumulate across multiple deltas within one run', () => {
  const context = freshContext();
  mergeContext(context, { notifications: [{ intentId: '1' }] });
  mergeContext(context, { notifications: [{ intentId: '2' }] });
  assert.deepEqual(context.notifications, [{ intentId: '1' }, { intentId: '2' }]);
});

test('a delta touching neither bucket leaves them untouched', () => {
  const context = freshContext();
  context.alertStates = { transitions: [{ stateKey: 'kept' }] };
  context.notifications = [{ intentId: 'kept' }];
  mergeContext(context, { metrics: { foo: 1 } });
  assert.deepEqual(context.alertStates, { transitions: [{ stateKey: 'kept' }] });
  assert.deepEqual(context.notifications, [{ intentId: 'kept' }]);
});
