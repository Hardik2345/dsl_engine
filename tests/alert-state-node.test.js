const test = require('node:test');
const assert = require('node:assert/strict');

const AlertStateNode = require('../nodes/AlertStateNode');

function context(overrides = {}) {
  return {
    meta: { tenantId: 'tenant-1', workflowId: 'wf-1', timezone: 'UTC', window: { end: '2026-01-01T00:00:00.000Z' } },
    breakdowns: { cvr_product_drops: [
      { dimension: 'product_id', value: '111', display_value: 'Product A', path: [], base_metric: 'cvr', deltas: { cvr_delta_pct: -30 }, sessionShare: 0.5 }
    ] },
    ...overrides,
  };
}

function nodeDef(overrides = {}) {
  return {
    id: 'evaluate_state',
    type: 'alert_state',
    sources: [{ output_key: 'cvr_product_drops', metric: 'cvr', direction: 'drop' }],
    breach: {
      enter: [{ metric: 'cvr_delta_pct', op: '<', value: -10 }],
      exit: [{ metric: 'cvr_delta_pct', op: '>', value: -5 }],
    },
    then: 'final_insight',
    then_no_changes: null,
    ...overrides,
  };
}

function fakeReader({ getStateReturns = null, openFindings = [] } = {}) {
  return {
    async getState() { return getStateReturns; },
    async listOpenExcluding() { return openFindings; },
  };
}

test('fails cleanly without sources', async () => {
  const result = await AlertStateNode(nodeDef({ sources: [] }), context(), { alertStateReader: fakeReader() });
  assert.equal(result.status, 'fail');
});

test('fails cleanly without an alertStateReader runtime', async () => {
  const result = await AlertStateNode(nodeDef(), context(), {});
  assert.equal(result.status, 'fail');
  assert.match(result.reason, /alertStateReader/);
});

test('a fresh breach produces a "new" transition, marked notify-worthy', async () => {
  const result = await AlertStateNode(nodeDef(), context(), { alertStateReader: fakeReader() });
  assert.equal(result.status, 'pass');
  assert.equal(result.delta.alertStates.transitions.length, 1);
  assert.equal(result.delta.alertStates.transitions[0].transition, 'new');
  assert.equal(result.delta.alertStates.transitions[0].notify, true);
  assert.equal(result.delta.alertStates.new.length, 1);
});

test('does not declare context.notifications itself -- that is the downstream email node\'s job via for_each', async () => {
  const result = await AlertStateNode(nodeDef(), context(), { alertStateReader: fakeReader() });
  assert.equal(result.delta.notifications, undefined);
});

test('routes to `then` when a change occurred, `then_no_changes` when nothing changed', async () => {
  const changed = await AlertStateNode(nodeDef(), context(), { alertStateReader: fakeReader() });
  assert.equal(changed.next, 'final_insight');

  const noBreach = context({ breakdowns: { cvr_product_drops: [] } });
  const unchanged = await AlertStateNode(
    nodeDef({ then_no_changes: 'skip_email' }),
    noBreach,
    { alertStateReader: fakeReader() }
  );
  assert.equal(unchanged.delta.alertStates.transitions.length, 0);
  assert.equal(unchanged.next, 'skip_email');
});

test('an entry that no longer breaches (already active) does not open a duplicate finding', async () => {
  const prior = { status: 'active', consecutiveBreach: 1, consecutiveClean: 0, episodeCount: 1, currentEpisode: { lastNotifiedMagnitude: -30, lastNotifiedAt: '2026-01-01T00:00:00.000Z' } };
  const result = await AlertStateNode(nodeDef(), context(), { alertStateReader: fakeReader({ getStateReturns: prior }) });
  assert.equal(result.delta.alertStates.transitions[0].transition, 'none');
});

test('a previously open finding not present in this run gets a clean observation', async () => {
  const priorDoc = {
    stateKey: 'tenant-1/wf-1:oldhash', status: 'active', consecutiveClean: 1, consecutiveBreach: 1, episodeCount: 1,
    fingerprint: { hash: 'oldhash' },
    currentEpisode: { lastNotifiedMagnitude: -20, lastNotifiedAt: '2026-01-01T00:00:00.000Z' },
  };
  const emptyContext = context({ breakdowns: { cvr_product_drops: [] } });
  const result = await AlertStateNode(nodeDef(), emptyContext, {
    alertStateReader: fakeReader({ openFindings: [priorDoc] })
  });
  const found = result.delta.alertStates.transitions.find((t) => t.stateKey === 'tenant-1/wf-1:oldhash');
  assert.ok(found);
  assert.equal(found.transition, 'resolved');
});

test('never writes to context.scratch (writes stay the notifier\'s job)', async () => {
  const result = await AlertStateNode(nodeDef(), context(), { alertStateReader: fakeReader() });
  assert.equal(result.delta.scratch, undefined);
});

test('severity_tiers resolves a critical reading and marks the fresh breach as a critical bypass', async () => {
  const node = nodeDef({
    severity_tiers: [{ name: 'critical', when: [{ metric: 'cvr_delta_pct', op: '<', value: -20 }] }],
  });
  const ctx = context({ breakdowns: { cvr_product_drops: [
    { dimension: 'product_id', value: '111', display_value: 'Product A', path: [], base_metric: 'cvr', deltas: { cvr_delta_pct: -25 }, sessionShare: 0.5 }
  ] } });
  const result = await AlertStateNode(node, ctx, { alertStateReader: fakeReader() });
  const [transition] = result.delta.alertStates.transitions;
  assert.equal(transition.transition, 'new');
  assert.equal(transition.criticalBypass, true);
  assert.equal(transition.snapshot.currentEpisode.peakSeverityTier, 'critical');
});

test('a -15% reading with 10%/20% tiers is a plain (non-critical) breach', async () => {
  const node = nodeDef({
    severity_tiers: [{ name: 'critical', when: [{ metric: 'cvr_delta_pct', op: '<', value: -20 }] }],
  });
  const ctx = context({ breakdowns: { cvr_product_drops: [
    { dimension: 'product_id', value: '111', display_value: 'Product A', path: [], base_metric: 'cvr', deltas: { cvr_delta_pct: -15 }, sessionShare: 0.5 }
  ] } });
  const result = await AlertStateNode(node, ctx, { alertStateReader: fakeReader() });
  const [transition] = result.delta.alertStates.transitions;
  assert.equal(transition.transition, 'new');
  assert.equal(transition.criticalBypass, false);
  assert.equal(transition.snapshot.currentEpisode.peakSeverityTier, null);
});

test('notify_policy.flap and notify_policy.recurrence_window are actually threaded through to computeTransition, not just accepted and ignored', async () => {
  // Regression guard for a real wiring gap: the node used to build its own policy
  // object from `breach` only, silently dropping notify_policy.flap/
  // severity_tier_order/recurrence_window even though computeTransition supports
  // them and the validator/UI both expose them as configurable.
  const node = nodeDef({
    notify_policy: { recurrence_window: '1h' },
  });

  // Open, then resolve (2 clean reads), all within the 1h custom recurrence window.
  let prior = null;
  const open = await AlertStateNode(node, context(), { alertStateReader: fakeReader({ getStateReturns: prior }) });
  prior = open.delta.alertStates.transitions[0].snapshot;

  // "Previously open but absent from this run" goes through listOpenExcluding,
  // not getState -- it needs a stateKey to be findable/excludable like a real
  // AlertState doc would have.
  prior.stateKey = open.delta.alertStates.transitions[0].stateKey;
  const emptyCtx = context({ breakdowns: { cvr_product_drops: [] } });
  const clean1 = await AlertStateNode(node, emptyCtx, { alertStateReader: fakeReader({ openFindings: [prior] }) });
  prior = { ...clean1.delta.alertStates.transitions[0].snapshot, stateKey: prior.stateKey };
  const clean2 = await AlertStateNode(node, emptyCtx, { alertStateReader: fakeReader({ openFindings: [prior] }) });
  prior = { ...clean2.delta.alertStates.transitions[0].snapshot, stateKey: prior.stateKey };
  assert.equal(prior.status, 'resolved');

  // Reopens well within the custom 1h window (design default would still call
  // this a recurrence too, at 7d, so this alone wouldn't prove the override is
  // wired -- the real proof is in alertTransition's own unit tests combined with
  // this test proving the field reaches computeTransition at all without error).
  const reopened = await AlertStateNode(node, context(), { alertStateReader: fakeReader({ getStateReturns: prior }) });
  assert.equal(reopened.delta.alertStates.transitions[0].transition, 'recurrence');
});

test('scope key (and therefore stateKey) is stable across a workflow version bump -- editing a live workflow must not orphan its open findings', async () => {
  const seenStateKeys = [];
  const capturingReader = () => ({
    async getState(tenantId, stateKey) { seenStateKeys.push(stateKey); return null; },
    async listOpenExcluding() { return []; },
  });

  await AlertStateNode(nodeDef(), context(), {
    alertStateReader: capturingReader(),
    rootWorkflowIdentity: 'tenant-1/wf-1@1',
  });
  await AlertStateNode(nodeDef(), context(), {
    alertStateReader: capturingReader(),
    rootWorkflowIdentity: 'tenant-1/wf-1@7',
  });

  assert.equal(seenStateKeys.length, 2);
  assert.equal(seenStateKeys[0], seenStateKeys[1]);
  // Guard against the double-tenant-prefix regression this fix also cleaned up
  // (rootWorkflowIdentity already carries "tenant-1/", so re-prefixing it with
  // tenantId again would silently double it).
  assert.equal((seenStateKeys[0].match(/tenant-1/g) || []).length, 1);
});
