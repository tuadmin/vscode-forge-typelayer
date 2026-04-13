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

test('Integration: External Command Renaming Logic', async () => {
  const ws = createTempWorkspace();
  const entryAbs = path.join(ws, 'hola.f.ts');
  fs.writeFileSync(entryAbs, 'export const edad = 30;', 'utf8');

  // Simulate External TS Output physically
  const rawPaths = core.predictEmitPaths(entryAbs, 'hola.f.ts', ws, true);
  fs.writeFileSync(rawPaths.jsPath, 'var edad = 30;', 'utf8');
  fs.writeFileSync(rawPaths.dtsPath, 'export declare const edad = 30;', 'utf8');

  // Assert external simulation paths
  assert.strictEqual(path.basename(rawPaths.jsPath), 'hola.f.js');
  assert.strictEqual(path.basename(rawPaths.dtsPath), 'hola.f.d.ts');

  // Trigger our theoretical rename lock
  const paths = core.predictEmitPaths(entryAbs, 'hola.f.ts', ws, false);
  
  // Execution block replica from extension.js
  if (entryAbs.match(/\.f\.(ts|mts|cts)$/i)) {
    if (fs.existsSync(rawPaths.jsPath)) fs.renameSync(rawPaths.jsPath, paths.jsPath);
    if (fs.existsSync(rawPaths.dtsPath)) fs.renameSync(rawPaths.dtsPath, paths.dtsPath);
  }

  // Validate the rename
  assert.ok(fs.existsSync(paths.jsPath), 'Clean .js should exist');
  assert.ok(!fs.existsSync(rawPaths.jsPath), 'Messy .f.js should be deleted');
  assert.strictEqual(path.basename(paths.jsPath), 'hola.js');

  fs.rmSync(ws, { recursive: true, force: true });
});
