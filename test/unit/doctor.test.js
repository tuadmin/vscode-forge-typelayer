const assert = require('assert');
const path = require('path');
const fs = require('fs');
const core = require('../../src/core');

describe('doctor report', () => {
  const workspace = path.resolve(__dirname, '../../test-fixtures/workspace');

  it('builds a doctor report with manifest and hints', () => {
    assert.ok(fs.existsSync(workspace),
      `test-fixtures/workspace not found. Run: mkdir -p test-fixtures/workspace`);
    const report = core.buildDoctorReport(workspace, 'auto', 'forge-typelayer.entries.json');
    assert.ok(report.manifestPath.endsWith('forge-typelayer.entries.json'));
    assert.ok(report.hints.packageJson.endsWith('package.json'));
    assert.ok(report.lint.kind);
  });
});
