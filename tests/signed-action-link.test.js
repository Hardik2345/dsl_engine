const test = require('node:test');
const assert = require('node:assert/strict');

const ORIGINAL_SECRET = process.env.FINDING_ACTION_JWT_SECRET;

function withSecret(value, fn) {
  // Assigning undefined to process.env coerces to the string "undefined" in
  // Node, not an unset var -- must delete explicitly to truly unset it.
  if (value === undefined) delete process.env.FINDING_ACTION_JWT_SECRET;
  else process.env.FINDING_ACTION_JWT_SECRET = value;
  try {
    // Force a fresh module instance so it re-reads process.env at call time --
    // getSecret() reads process.env live (not cached at require-time), so this is
    // only needed for clarity, not correctness, but keeps tests independent.
    delete require.cache[require.resolve('../server/lib/signedActionLink')];
    return fn(require('../server/lib/signedActionLink'));
  } finally {
    if (ORIGINAL_SECRET === undefined) delete process.env.FINDING_ACTION_JWT_SECRET;
    else process.env.FINDING_ACTION_JWT_SECRET = ORIGINAL_SECRET;
  }
}

test('sign then verify round-trips the payload', () => {
  withSecret('test-secret', ({ signActionToken, verifyActionToken }) => {
    const token = signActionToken({ tenantId: 'tenant-1', stateKey: 'k1', action: 'ack' });
    const payload = verifyActionToken(token);
    assert.equal(payload.tenantId, 'tenant-1');
    assert.equal(payload.stateKey, 'k1');
    assert.equal(payload.action, 'ack');
  });
});

test('an expired token is rejected', () => {
  withSecret('test-secret', ({ signActionToken, verifyActionToken }) => {
    const token = signActionToken({ tenantId: 'tenant-1', stateKey: 'k1', action: 'ack', expiresIn: '-1s' });
    assert.throws(() => verifyActionToken(token), /invalid or expired/);
  });
});

test('a tampered token is rejected', () => {
  withSecret('test-secret', ({ signActionToken, verifyActionToken }) => {
    const token = signActionToken({ tenantId: 'tenant-1', stateKey: 'k1', action: 'ack' });
    const tampered = token.slice(0, -2) + (token.slice(-2) === 'aa' ? 'bb' : 'aa');
    assert.throws(() => verifyActionToken(tampered), /invalid or expired/);
  });
});

test('a token signed with a different secret is rejected', () => {
  const token = withSecret('secret-a', ({ signActionToken }) =>
    signActionToken({ tenantId: 'tenant-1', stateKey: 'k1', action: 'ack' }));
  withSecret('secret-b', ({ verifyActionToken }) => {
    assert.throws(() => verifyActionToken(token), /invalid or expired/);
  });
});

test('signing fails closed when no secret is configured, rather than silently succeeding', () => {
  withSecret(undefined, ({ signActionToken }) => {
    assert.throws(() => signActionToken({ tenantId: 'tenant-1', stateKey: 'k1', action: 'ack' }), /not configured/);
  });
});

test('verifying fails closed when no secret is configured', () => {
  withSecret(undefined, ({ verifyActionToken }) => {
    assert.throws(() => verifyActionToken('anything'), /not configured/);
  });
});

test('verifying a missing token is rejected without throwing an unrelated error', () => {
  withSecret('test-secret', ({ verifyActionToken }) => {
    assert.throws(() => verifyActionToken(undefined), /invalid or expired/);
  });
});
