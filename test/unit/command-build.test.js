const assert = require('assert');
const path = require('path');
const core = require('../../src/core');

describe('command builder', () => {
  test('builds bun command with bunx tsc', () => {
    const workspace = path.resolve(__dirname, '../../test-fixtures/workspace');
    const cmd = core.buildRuntimeCommand('bun', {
      workspacePath: workspace,
      entryAbs: path.join(workspace, 'private', 'math', 'index.mts'),
      outBaseAbs: path.join(workspace, 'dist', 'math', 'index'),
      config: { target: 'ES2022', removeComments: false }
    });
    assert.strictEqual(cmd.command, 'bunx');
  });
});
