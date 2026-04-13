const assert = require('assert');
const path = require('path');
const core = require('../../src/core');

describe('lint strategy', () => {
  test('detects lint config and returns strategy object', () => {
    const workspace = path.resolve(__dirname, '../../test-fixtures/workspace');
    const strategy = core.detectLintStrategy(workspace, 'tsc');
    assert.ok(['eslint-binary', 'none', 'deno-lint'].includes(strategy.kind));
  });
});
