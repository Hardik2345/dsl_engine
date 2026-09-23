const test = require('node:test');
const assert = require('node:assert/strict');

const { validateWorkflowDefinition } = require('../server/validation/workflowDefinition');
const WorkflowRunner = require('../engine/WorkflowRunner');

// The primary "Phase 3 works end to end" proof point: one complete workflow JSON
// using alert_state + notify_policy + a for_each finding email, validated then run
// through the real runner with injected runtime stubs (state reader, email sender)
// and no real DB/SMTP -- asserting the full chain: condition evaluation ->
// transition -> intent declaration -> per-finding fan-out.
function buildWorkflow() {
  return {
    workflow_type: 'root_cause_analysis',
    version: '1',
    workflow_id: 'cvr_state_demo',
    trigger: { type: 'alert', alertType: 'cvr_drop', brandScope: 'single', brandIds: ['tenant-1'] },
    nodes: [
      {
        id: 'evaluate_state',
        type: 'alert_state',
        sources: [{ output_key: 'cvr_product_drops', metric: 'cvr', direction: 'drop' }],
        state_scope: { mode: 'workflow' },
        breach: {
          enter: [{ metric: 'cvr_delta_pct', op: '<', value: -10 }],
          exit: [{ metric: 'cvr_delta_pct', op: '>', value: -5 }],
        },
        severity_tiers: [
          { name: 'critical', when: [{ metric: 'cvr_delta_pct', op: '<', value: -50 }] },
        ],
        notify_policy: { min_interval: '24h' },
        then: 'send_finding_email',
        then_no_changes: null,
      },
      {
        id: 'send_finding_email',
        type: 'email',
        format: 'finding',
        for_each: 'alertStates.transitions',
        to: ['ops@example.com'],
        subject: 'ignored for finding format',
      },
    ],
  };
}

function contextWithBreachingProduct() {
  return {
    meta: { tenantId: 'tenant-1', timezone: 'UTC', window: { end: '2026-01-05T00:00:00.000Z' } },
    filters: [],
    metrics: {},
    rootCausePath: [],
    scratch: {},
    breakdowns: {
      cvr_product_drops: [
        { dimension: 'product_id', value: '111', display_value: 'Product A', path: [], base_metric: 'cvr', deltas: { cvr_delta_pct: -60 }, sessionShare: 0.5 },
      ],
    },
  };
}

test('the workflow JSON itself is valid', () => {
  const result = validateWorkflowDefinition(buildWorkflow());
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('a breaching run: condition evaluation -> transition -> intent declaration -> per-finding fan-out', async () => {
  let smtpCalled = false;
  const alertStateReader = {
    async getState() { return null; }, // fresh finding, nothing seen before
    async listOpenExcluding() { return []; },
  };

  const runner = new WorkflowRunner(buildWorkflow(), {
    workflowIdentity: 'tenant-1/cvr_state_demo@1',
    alertStateReader,
    emailSender: async () => { smtpCalled = true; return { status: 'sent' }; },
  });

  const result = await runner.executeWorkflow(contextWithBreachingProduct());

  assert.equal(result.status, 'completed');
  // alert_state computed exactly one finding and it's a fresh breach.
  assert.equal(result.context.alertStates.transitions.length, 1);
  assert.equal(result.context.alertStates.transitions[0].transition, 'new');
  // The email node's for_each declared one intent from it -- no SMTP call happened,
  // even though an emailSender was injected and available.
  assert.equal(result.context.notifications.length, 1);
  assert.equal(result.context.notifications[0].format, 'finding');
  assert.equal(smtpCalled, false);
});

test('a clean run (nothing breaching, no prior findings) declares no findings and routes via then_no_changes', async () => {
  const workflow = buildWorkflow();
  workflow.nodes[0].then_no_changes = 'send_finding_email'; // same target, just proving the routing branch taken
  const alertStateReader = { async getState() { return null; }, async listOpenExcluding() { return []; } };
  const runner = new WorkflowRunner(workflow, { workflowIdentity: 'tenant-1/cvr_state_demo@1', alertStateReader });

  const cleanContext = contextWithBreachingProduct();
  cleanContext.breakdowns.cvr_product_drops = [];

  const result = await runner.executeWorkflow(cleanContext);
  assert.equal(result.status, 'completed');
  assert.equal(result.context.alertStates.transitions.length, 0);
  assert.equal(result.context.notifications.length, 0);
});

test('a rerun clears alertStates/notifications from a prior execution before the workflow runs again', () => {
  const { normalizeRerunContext } = require('../lib/timeWindowUtils');
  const priorContext = contextWithBreachingProduct();
  priorContext.alertStates = { transitions: [{ stateKey: 'stale' }] };
  priorContext.notifications = [{ intentId: 'stale' }];

  const rerun = normalizeRerunContext(priorContext, 'UTC');
  assert.deepEqual(rerun.alertStates, {});
  assert.deepEqual(rerun.notifications, []);
});
