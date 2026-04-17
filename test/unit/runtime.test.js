const assert = require('assert');
const path = require('path');
const fs = require('fs');
const core = require('../../src/core');

describe('runtime detection', () => {
  const workspace = path.resolve(__dirname, '../../test-fixtures/workspace');

  it('detects config hints', () => {
    assert.ok(fs.existsSync(workspace),
      `test-fixtures/workspace not found. Run: mkdir -p test-fixtures/workspace`);
    const hints = core.detectProjectHints(workspace);
    assert.ok(hints.denoConfig.endsWith('deno.json'));
    assert.ok(hints.tsconfig.endsWith('tsconfig.json'));
    assert.ok(hints.jsconfig.endsWith('jsconfig.json'));
    assert.ok(hints.packageJson.endsWith('package.json'));
  });
});
