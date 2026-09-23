const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeScopeKey,
  computeFingerprint,
  computeFingerprintHash,
  computeStateKey,
} = require('../server/lib/fingerprint');

function baseArgs(overrides = {}) {
  return {
    entry: { dimension: 'product_id', value: '12345', path: [] },
    metric: 'cvr',
    direction: 'drop',
    outputKey: 'cvr_product_drops',
    ruleId: null,
    scopeKey: 'tenant-1/wf-1::previous_complete_day',
    ...overrides,
  };
}

function hashFor(overrides = {}) {
  return computeFingerprintHash(computeFingerprint(baseArgs(overrides)));
}

test('scope key defaults to per-workflow and includes window mode', () => {
  const key = computeScopeKey({ tenantId: 'tenant-1', workflowId: 'wf-1', windowMode: 'previous_complete_day' });
  assert.equal(key, 'tenant-1/wf-1::previous_complete_day');
});

test('group scope shares one stream across workflows', () => {
  const key = computeScopeKey({
    tenantId: 'tenant-1', workflowId: 'wf-1',
    stateScope: { mode: 'group', group: 'rca-suite' }, windowMode: 'previous_complete_day'
  });
  assert.equal(key, 'tenant-1/group:rca-suite::previous_complete_day');
});

test('a display-value-only edit does not change the fingerprint hash', () => {
  const withoutDisplay = hashFor({ entry: { dimension: 'product_id', value: '12345', path: [] } });
  const withDisplay = hashFor({ entry: { dimension: 'product_id', value: '12345', display_value: 'New Product Title', path: [] } });
  assert.equal(withoutDisplay, withDisplay);
});

test('editing only a product title does not open a new finding', () => {
  const before = hashFor({ entry: { dimension: 'product_id', value: '999', display_value: 'Old Title' } });
  const after = hashFor({ entry: { dimension: 'product_id', value: '999', display_value: 'Brand New Title' } });
  assert.equal(before, after);
});

test('landing_page_path normalizes query string, trailing slash, duplicate slashes and case', () => {
  const variants = [
    '/checkout',
    '/checkout/',
    '/checkout?utm_source=fb',
    '/checkout#top',
    '//checkout',
    '/CHECKOUT',
  ];
  const hashes = variants.map((value) => hashFor({ entry: { dimension: 'landing_page_path', value } }));
  const [first, ...rest] = hashes;
  rest.forEach((hash) => assert.equal(hash, first));
});

test('null, empty and literal "unknown" dimension values collapse to the same bucket', () => {
  const variants = [null, undefined, '', '   ', 'unknown', 'Unknown'];
  const hashes = variants.map((value) => hashFor({ entry: { dimension: 'utm_source', value } }));
  const [first, ...rest] = hashes;
  rest.forEach((hash) => assert.equal(hash, first));
});

test('numeric and string forms of the same id hash identically', () => {
  const numeric = hashFor({ entry: { dimension: 'product_id', value: 123 } });
  const string = hashFor({ entry: { dimension: 'product_id', value: '123' } });
  assert.equal(numeric, string);
});

test('a different metric produces a different hash for the same entry', () => {
  assert.notEqual(hashFor({ metric: 'cvr' }), hashFor({ metric: 'atc_rate' }));
});

test('a different direction produces a different hash for the same entry', () => {
  assert.notEqual(hashFor({ direction: 'drop' }), hashFor({ direction: 'increase' }));
});

test('a different output key produces a different hash for the same entry', () => {
  assert.notEqual(hashFor({ outputKey: 'cvr_product_drops' }), hashFor({ outputKey: 'cvr_source_drops' }));
});

test('a different window mode (via scopeKey) produces a different state key', () => {
  const hash = hashFor();
  const daily = computeStateKey('tenant-1/wf-1::previous_complete_day', hash);
  const hourly = computeStateKey('tenant-1/wf-1::day_to_date_vs_previous_day', hash);
  assert.notEqual(daily, hourly);
});

test('an unrelated dimension/value produces a different hash entirely', () => {
  const productDrop = hashFor({ entry: { dimension: 'product_id', value: '111' } });
  const sourceDrop = hashFor({ entry: { dimension: 'utm_source', value: 'facebook' } });
  assert.notEqual(productDrop, sourceDrop);
});
