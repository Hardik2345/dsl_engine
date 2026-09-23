const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveFindingValue, classifySeverity } = require('../server/lib/stateEngine/severity');

const thresholds = { normal: 15, critical: 25 };

test('drop: a raw cvr_delta_pct of -17 resolves to a finding value of 17', () => {
  const finding = resolveFindingValue({ metrics: { cvr_delta_pct: -17 } }, { metric: 'cvr_delta_pct', direction: 'drop' });
  assert.equal(finding.conclusive, true);
  assert.equal(finding.raw, -17);
  assert.equal(finding.value, 17);
  assert.equal(classifySeverity(finding.value, thresholds), 'TRIGGERED');
});

test('drop: a rise of +5 resolves to -5 and is NORMAL', () => {
  const finding = resolveFindingValue({ metrics: { cvr_delta_pct: 5 } }, { metric: 'cvr_delta_pct', direction: 'drop' });
  assert.equal(finding.value, -5);
  assert.equal(classifySeverity(finding.value, thresholds), 'NORMAL');
});

test('drop: a zero delta normalizes to 0, not -0', () => {
  const finding = resolveFindingValue({ metrics: { cvr_delta_pct: 0 } }, { metric: 'cvr_delta_pct', direction: 'drop' });
  assert.ok(Object.is(finding.value, 0));
});

test('rise keeps the sign and absolute takes the magnitude', () => {
  const context = { metrics: { sessions_delta_pct: -30 } };
  assert.equal(resolveFindingValue(context, { metric: 'sessions_delta_pct', direction: 'rise' }).value, -30);
  assert.equal(resolveFindingValue(context, { metric: 'sessions_delta_pct', direction: 'absolute' }).value, 30);
  assert.equal(resolveFindingValue({ metrics: { x: 30 } }, { metric: 'x', direction: 'rise' }).value, 30);
});

test('numeric strings are accepted', () => {
  const finding = resolveFindingValue({ metrics: { cvr_delta_pct: '-20.5' } }, { metric: 'cvr_delta_pct', direction: 'drop' });
  assert.equal(finding.value, 20.5);
});

test('thresholds are inclusive', () => {
  assert.equal(classifySeverity(14.99, thresholds), 'NORMAL');
  assert.equal(classifySeverity(15, thresholds), 'TRIGGERED');
  assert.equal(classifySeverity(24.99, thresholds), 'TRIGGERED');
  assert.equal(classifySeverity(25, thresholds), 'CRITICAL');
});

test('a missing or non-finite metric is inconclusive', () => {
  const finding = { metric: 'cvr_delta_pct', direction: 'drop' };
  assert.equal(resolveFindingValue({ metrics: {} }, finding).conclusive, false);
  assert.equal(resolveFindingValue({}, finding).conclusive, false);
  assert.equal(resolveFindingValue({ metrics: { cvr_delta_pct: null } }, finding).conclusive, false);
  assert.equal(resolveFindingValue({ metrics: { cvr_delta_pct: NaN } }, finding).conclusive, false);
  assert.equal(resolveFindingValue({ metrics: { cvr_delta_pct: 'unknown' } }, finding).conclusive, false);
  assert.equal(resolveFindingValue({ metrics: { cvr_delta_pct: '' } }, finding).conclusive, false);
});
