const assert = require('assert');
const core = require('../../src/core');

describe('binary spawn wrapper', () => {
  test('spawn wrapper returns structured result for missing binary', () => {
    const result = core.runExternalCommand('definitely-not-a-real-binary-for-forge-typelayer', ['--version'], process.cwd());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(typeof result.stderr, 'string');
  });
});
