const assert = require('assert');
const path = require('path');
const core = require('../../src/core');

describe('doctor report', () => {
  test('builds a doctor report with manifest and hints', () => {
    const workspace = path.resolve(__dirname, '../../test-fixtures/workspace');
    const report = core.buildDoctorReport(workspace, 'auto', 'forge-typelayer.entries.json');
    assert.ok(report.manifestPath.endsWith('forge-typelayer.entries.json'));
    assert.ok(report.hints.packageJson.endsWith('package.json'));
    assert.ok(report.lint.kind);
  });
});
