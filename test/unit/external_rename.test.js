const assert = require('assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const core = require('../../src/core');

function createTempWorkspace() {
  const ws = path.join(__dirname, 'temp_ws_ext_' + Date.now());
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

['.f.ts', '.forge.ts', '.source.ts'].forEach(suffix => {
  test(`Integration: External Command Renaming Logic with ${suffix}`, async () => {
    const ws = createTempWorkspace();
    const entryAbs = path.join(ws, `hola${suffix}`);
    fs.writeFileSync(entryAbs, 'export const edad = 30;', 'utf8');

    const lockSuffixes = ['.f.ts', '.forge.ts', '.source.ts', '.f.mts', '.forge.mts', '.source.mts'];

    // Simulate External TS Output physically
    // Signature: (entryAbs, outBaseRel, workspacePath, lockSuffixes, preserveRaw)
    const rawPaths = core.predictEmitPaths(entryAbs, `hola${suffix}`, ws, lockSuffixes, true);
    fs.writeFileSync(rawPaths.jsPath, 'var edad = 30;', 'utf8');
    fs.writeFileSync(rawPaths.dtsPath, 'export declare const edad = 30;', 'utf8');

    // Trigger our theoretical rename lock
    const paths = core.predictEmitPaths(entryAbs, `hola${suffix}`, ws, lockSuffixes, false);
    
    // Execution block replica from extension.js
    const isLockEntry = lockSuffixes.some(s => entryAbs.endsWith(s));
    if (isLockEntry) {
      if (fs.existsSync(rawPaths.jsPath)) fs.renameSync(rawPaths.jsPath, paths.jsPath);
      if (fs.existsSync(rawPaths.dtsPath)) fs.renameSync(rawPaths.dtsPath, paths.dtsPath);
    }

    // Validate the rename
    assert.ok(fs.existsSync(paths.jsPath), `Clean .js should exist for ${suffix}`);
    assert.ok(!fs.existsSync(rawPaths.jsPath), `Messy lock file should be deleted for ${suffix}`);
    assert.strictEqual(path.basename(paths.jsPath), 'hola.js');

    fs.rmSync(ws, { recursive: true, force: true });
  });
});
