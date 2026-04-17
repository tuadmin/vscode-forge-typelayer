const assert = require('assert');
const path = require('path');
const fs = require('fs');
const core = require('../../src/core');

describe('manifest resolution', () => {
  const workspace = path.resolve(__dirname, '../../test-fixtures/workspace');

  it('resolves owner for helper inside entry subtree', () => {
    assert.ok(fs.existsSync(workspace),
      `test-fixtures/workspace not found. Run: mkdir -p test-fixtures/workspace`);
    const file = path.join(workspace, 'private', 'math', '_core.ts');
    const owner = core.resolveOwningEntryByFile(workspace, 'forge-typelayer.entries.json', file);
    assert.ok(owner);
    assert.strictEqual(owner.outBaseRel, 'dist/math/index');
  });
});
