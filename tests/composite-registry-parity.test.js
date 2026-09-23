const test = require('node:test');
const assert = require('node:assert/strict');

// CompositeNode maintains its own independent copy of WorkflowRunner's node
// registry (it controls its own step loop rather than delegating). Nothing enforces
// the two staying in sync today, so this test exists to turn "forgot to add a new
// node type to one of the two registries" into a test failure rather than a runtime
// surprise the next time someone adds a node type.
test('CompositeNode and WorkflowRunner register the same set of node types', () => {
  delete require.cache[require.resolve('../nodes/CompositeNode')];
  delete require.cache[require.resolve('../engine/WorkflowRunner')];

  // Both modules keep their registries private, so this test re-derives the key set
  // from the source rather than requiring either module to export internals it
  // otherwise has no reason to export.
  const compositeSource = require('fs').readFileSync(require.resolve('../nodes/CompositeNode.js'), 'utf8');
  const runnerSource = require('fs').readFileSync(require.resolve('../engine/WorkflowRunner.js'), 'utf8');

  function extractRegistryKeys(source) {
    const match = source.match(/const NodeRegistry = \{([\s\S]*?)\n\};/);
    if (!match) throw new Error('could not locate NodeRegistry object literal');
    return match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//'))
      .map((line) => line.split(':')[0].trim())
      .filter(Boolean)
      .sort();
  }

  // WorkflowRunner's registry additionally includes 'composite' itself (composite is
  // a top-level node type the runner dispatches); CompositeNode's own registry
  // deliberately excludes it -- composite steps cannot nest another composite. That
  // is the one intentional, pre-existing difference; every other key must match.
  const runnerKeys = extractRegistryKeys(runnerSource).filter((key) => key !== 'composite');
  assert.deepEqual(extractRegistryKeys(compositeSource), runnerKeys);
});
