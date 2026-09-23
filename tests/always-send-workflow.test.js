const test = require('node:test');
const assert = require('node:assert/strict');

const { validateWorkflowDefinition } = require('../server/validation/workflowDefinition');

function baseWorkflow(overrides = {}) {
  return {
    workflow_type: 'root_cause_analysis', version: '1',
    trigger: { type: 'alert', alertType: 'daily', brandScope: 'single', brandIds: ['tenant-1'] },
    nodes: [{ id: 'insight', type: 'insight', template: { summary: 'done', details: [] } }],
    ...overrides,
  };
}

test('always_send accepts a boolean', () => {
  assert.deepEqual(validateWorkflowDefinition(baseWorkflow({ always_send: true })), { ok: true, errors: [] });
  assert.deepEqual(validateWorkflowDefinition(baseWorkflow({ always_send: false })), { ok: true, errors: [] });
});

test('always_send is optional -- omitting it is still valid', () => {
  assert.deepEqual(validateWorkflowDefinition(baseWorkflow()), { ok: true, errors: [] });
});

test('always_send rejects a non-boolean value', () => {
  const result = validateWorkflowDefinition(baseWorkflow({ always_send: 'yes' }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /always_send must be boolean/);
});
