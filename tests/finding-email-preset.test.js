const test = require('node:test');
const assert = require('node:assert/strict');

const { renderFindingEmail, buildSubject } = require('../server/lib/emailPresets/findingV1');

function finding(overrides = {}) {
  return {
    label: 'Product A',
    entry: { dimension: 'product_id', display_value: 'Product A', path: [] },
    transition: 'new',
    firstSeenAt: '2026-01-01',
    daysOpen: 1,
    episodeCount: 1,
    severityTier: 'warning',
    trend: [-20, -26],
    current: '0.90%',
    baseline: '1.20%',
    deltaPct: -25,
    stateKey: 'tenant-1/wf-1:hash',
    ...overrides,
  };
}

test('subject prefix reflects the transition', () => {
  assert.match(buildSubject({ finding: finding({ transition: 'new' }), brandName: 'Acme' }), /^\[NEW\]/);
  assert.match(buildSubject({ finding: finding({ transition: 'escalation', daysOpen: 4 }), brandName: 'Acme' }), /^\[WORSENING\] day 4/);
  assert.match(buildSubject({ finding: finding({ transition: 'resolved' }), brandName: 'Acme' }), /^\[RESOLVED\]/);
  assert.match(buildSubject({ finding: finding({ transition: 'recurrence' }), brandName: 'Acme' }), /^\[RECURRENCE\]/);
});

test('renderFindingEmail includes the trend line and current/baseline metrics', () => {
  const rendered = renderFindingEmail({ finding: finding(), brandNameOverride: 'Acme' });
  assert.match(rendered.html, /Product A/);
  assert.match(rendered.html, /-20\.00% .* -26\.00%/s);
  assert.match(rendered.text, /Current: 0\.90% \| Baseline: 1\.20%/);
});

test('renderFindingEmail does not crash when trend history is empty', () => {
  const rendered = renderFindingEmail({ finding: finding({ trend: [] }), brandNameOverride: 'Acme' });
  assert.doesNotMatch(rendered.html, /Trend:/);
});
