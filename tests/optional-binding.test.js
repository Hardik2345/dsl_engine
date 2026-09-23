const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveOptionalBinding } = require('../server/lib/renderReportEmail');

test('resolveOptionalBinding returns the value when present', () => {
  const root = { alertStates: { topFinding: { label: 'Product A' } } };
  assert.equal(resolveOptionalBinding(root, 'alertStates.topFinding.label'), 'Product A');
});

test('resolveOptionalBinding falls back rather than throwing when the binding is missing', () => {
  const root = { metrics: {} };
  assert.equal(resolveOptionalBinding(root, 'alertStates.transitions'), null);
  assert.deepEqual(resolveOptionalBinding(root, 'alertStates.transitions', []), []);
});

test('resolveOptionalBinding never throws for a report template with no state history at all', () => {
  const root = { meta: { tenantId: 'tenant-1' }, metrics: {}, breakdowns: {} };
  assert.doesNotThrow(() => resolveOptionalBinding(root, 'alertStates.topFinding.trend'));
});
