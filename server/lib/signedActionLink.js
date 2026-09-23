const jwt = require('jsonwebtoken');

// Deliberately a DEDICATED secret, not server/routes/auth.js's JWT_SECRET (which
// has a hardcoded fallback if unset -- a pre-existing weakness this must not
// inherit) and NOT server/routes/alertsIngest.js's ALERTS_INGEST_TOKEN pattern
// (which silently allows every request through when its env var is unset). This
// helper fails closed: no secret configured means no signed links work at all,
// rather than every link working unauthenticated.
function getSecret() {
  return process.env.FINDING_ACTION_JWT_SECRET;
}

function missingSecretError() {
  const err = new Error('FINDING_ACTION_JWT_SECRET is not configured');
  err.status = 500;
  return err;
}

function invalidTokenError() {
  const err = new Error('invalid or expired link');
  err.status = 401;
  return err;
}

// design §13.2. payload is deliberately minimal and closed: {tenantId, stateKey,
// action}. Expiry should match how long the action stays meaningful -- e.g. a
// week-old "ack" link on a since-changed finding is not useful.
function signActionToken({ tenantId, stateKey, action, expiresIn = '24h' }) {
  const secret = getSecret();
  if (!secret) throw missingSecretError();
  return jwt.sign({ tenantId, stateKey, action }, secret, { expiresIn, algorithm: 'HS256' });
}

function verifyActionToken(token) {
  const secret = getSecret();
  if (!secret) throw missingSecretError();
  if (!token) throw invalidTokenError();
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (error) {
    throw invalidTokenError();
  }
}

module.exports = { signActionToken, verifyActionToken };
