const assert = require('assert');
const path = require('path');
const core = require('../../src/core');

describe('manifest resolution', () => {
  test('resolves owner for helper inside entry subtree', () => {
    const workspace = path.resolve(__dirname, '../../test-fixtures/workspace');
    const file = path.join(workspace, 'private', 'math', '_core.ts');
    const owner = core.resolveOwningEntryByFile(workspace, 'forge-typelayer.entries.json', file);
    assert.ok(owner);
    assert.strictEqual(owner.outBaseRel, 'dist/math/index');
  });
});
