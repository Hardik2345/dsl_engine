const test = require('node:test');
const assert = require('node:assert/strict');

const { validateWorkflowDefinition } = require('../server/validation/workflowDefinition');

function baseWorkflow(nodes) {
  return {
    workflow_type: 'root_cause_analysis', version: '1',
    trigger: { type: 'alert', alertType: 'cvr_drop', brandScope: 'single', brandIds: ['tenant-1'] },
    nodes,
  };
}

function alertStateNode(overrides = {}) {
  return {
    id: 'evaluate_state',
    type: 'alert_state',
    sources: [{ output_key: 'cvr_product_drops', metric: 'cvr', direction: 'drop' }],
    breach: {
      enter: [{ metric: 'cvr_delta_pct', op: '<', value: -10 }],
      exit: [{ metric: 'cvr_delta_pct', op: '>', value: -5 }],
    },
    then: 'final_insight',
    ...overrides,
  };
}

function insightNode() {
  return { id: 'final_insight', type: 'insight', template: { summary: 'done', details: [] } };
}

test('a well-formed alert_state node passes validation', () => {
  const result = validateWorkflowDefinition(baseWorkflow([alertStateNode(), insightNode()]));
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('alert_state requires a non-empty sources array', () => {
  const result = validateWorkflowDefinition(baseWorkflow([alertStateNode({ sources: [] }), insightNode()]));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /must include a non-empty sources array/);
});

test('alert_state requires breach.enter and breach.exit', () => {
  const result = validateWorkflowDefinition(baseWorkflow([alertStateNode({ breach: {} }), insightNode()]));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /breach\.enter must be a non-empty array/);
  assert.match(result.errors.join('\n'), /breach\.exit must be a non-empty array/);
});

test('alert_state rejects an invalid comparison operator', () => {
  const result = validateWorkflowDefinition(baseWorkflow([
    alertStateNode({ breach: { enter: [{ metric: 'cvr_delta_pct', op: 'startsWith', value: -10 }], exit: [{ metric: 'cvr_delta_pct', op: '>', value: -5 }] } }),
    insightNode(),
  ]));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /invalid op startsWith/);
});

test('an unknown notify_policy field is rejected', () => {
  const result = validateWorkflowDefinition(baseWorkflow([
    alertStateNode({ notify_policy: { made_up_field: true } }),
    insightNode(),
  ]));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /unsupported field made_up_field/);
});

test('notify_policy.flap accepts a valid window_ms/max_episodes shape', () => {
  const result = validateWorkflowDefinition(baseWorkflow([
    alertStateNode({ notify_policy: { flap: { window_ms: 3600000, max_episodes: 5 } } }),
    insightNode(),
  ]));
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('notify_policy.flap rejects a non-positive window_ms and an unknown sub-field', () => {
  const result = validateWorkflowDefinition(baseWorkflow([
    alertStateNode({ notify_policy: { flap: { window_ms: -5, made_up: true } } }),
    insightNode(),
  ]));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /flap\.window_ms must be a positive number/);
  assert.match(result.errors.join('\n'), /unsupported field made_up/);
});

test('notify_policy.stale_after must be a positive number of milliseconds', () => {
  const result = validateWorkflowDefinition(baseWorkflow([
    alertStateNode({ notify_policy: { stale_after: 0 } }),
    insightNode(),
  ]));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /stale_after must be a positive number/);
});

test('notify_policy.severity_tier_order must be an array of non-empty strings', () => {
  const result = validateWorkflowDefinition(baseWorkflow([
    alertStateNode({ notify_policy: { severity_tier_order: ['warning', ''] } }),
    insightNode(),
  ]));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /severity_tier_order must be an array of non-empty strings/);
});

test('alert_state is rejected inside a composite node\'s steps', () => {
  const result = validateWorkflowDefinition(baseWorkflow([
    { id: 'group', type: 'composite', steps: ['evaluate_state'] },
    alertStateNode(),
    insightNode(),
  ]));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /cannot include alert_state step/);
});

test('an email node with format finding requires for_each', () => {
  const workflow = baseWorkflow([
    { id: 'send_finding_email', type: 'email', format: 'finding', to: ['ops@example.com'], subject: 'ignored' },
  ]);
  const result = validateWorkflowDefinition(workflow);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /format finding requires for_each/);
});

test('an email node with format finding and for_each is valid', () => {
  const workflow = baseWorkflow([
    { id: 'send_finding_email', type: 'email', format: 'finding', for_each: 'alertStates.transitions', to: ['ops@example.com'], subject: 'ignored' },
  ]);
  const result = validateWorkflowDefinition(workflow);
  assert.deepEqual(result, { ok: true, errors: [] });
});
