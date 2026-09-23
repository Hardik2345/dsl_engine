const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateSuppression, rankByEvidenceScore } = require('../server/lib/suppressionPipeline');
const { renderDigestEmail } = require('../server/lib/emailPresets/digest');

function candidate(entry, overrides = {}) {
  return {
    entry,
    transition: 'new',
    conclusive: true,
    dryRun: false,
    criticalBypass: false,
    humanState: {},
    flapDemoted: false,
    cooldownOk: true,
    isSignificant: true,
    now: new Date(),
    burstCap: 2,
    ...overrides,
  };
}

test('ranking by evidence score puts the highest-impact finding first', () => {
  const low = { base_metric: 'cvr', deltas: { cvr_delta_pct: -8 }, sessionShare: 0.5 };
  const high = { base_metric: 'cvr', deltas: { cvr_delta_pct: -40 }, sessionShare: 0.5 };
  const ranked = rankByEvidenceScore([{ entry: low }, { entry: high }]);
  assert.equal(ranked[0].entry, high);
});

test('a burst of findings sends only up to the cap immediately, the rest go to digest', () => {
  const entries = Array.from({ length: 8 }, (_, i) => ({
    base_metric: 'cvr', deltas: { cvr_delta_pct: -10 - i }, sessionShare: 0.1
  }));
  const ranked = rankByEvidenceScore(entries.map((entry) => ({ entry })));
  const decisions = ranked.map((item, rank) => evaluateSuppression(candidate(item.entry, { burstRank: rank })));

  const sent = decisions.filter((d) => d.action === 'send');
  const digested = decisions.filter((d) => d.action === 'digest' && d.reason === 'burst_cap');
  assert.equal(sent.length, 2);
  assert.equal(digested.length, 6);
});

test('digest email groups overflow findings by transition with one line each', () => {
  const items = [
    { stateKey: 'a', transition: 'new', snapshot: { label: 'Product A', deltaPct: -30 } },
    { stateKey: 'b', transition: 'new', snapshot: { label: 'Product B', deltaPct: -22 } },
    { stateKey: 'c', transition: 'escalation', snapshot: { label: 'Facebook Ads', deltaPct: -55 } },
  ];
  const rendered = renderDigestEmail({ items, brandNameOverride: 'Acme' });
  assert.match(rendered.subject, /3 findings/);
  assert.match(rendered.html, /Product A/);
  assert.match(rendered.html, /Product B/);
  assert.match(rendered.html, /Facebook Ads/);
  assert.match(rendered.text, /NEW:/);
  assert.match(rendered.text, /WORSENING:/);
});
