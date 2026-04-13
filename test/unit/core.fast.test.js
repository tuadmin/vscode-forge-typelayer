const assert = require('assert');
const { test } = require('node:test');
const core = require('../../src/core');
const path = require('path');

test('extractEmittedAssets should correctly find generated TS files', () => {
  const mockOutputs = new Map([
    ['/dist/myLib.c.js', 'console.log("js");'],
    ['/dist/myLib.c.d.ts', 'export {};'],
    ['/dist/sourceMap.js.map', '{}'] // Noise to ensure it doesn't break
  ]);

  const assets = core.extractEmittedAssets(mockOutputs);
  assert.strictEqual(assets.jsPath, '/dist/myLib.c.js');
  assert.strictEqual(assets.jsContent, 'console.log("js");');
  assert.strictEqual(assets.dtsPath, '/dist/myLib.c.d.ts');
});

test('extractEmittedAssets works with .mjs and .d.mts', () => {
  const mockOutputs = new Map([
    ['/dist/index.mjs', 'console.log("mjs");'],
    ['/dist/index.d.mts', 'export {};']
  ]);

  const assets = core.extractEmittedAssets(mockOutputs);
  assert.strictEqual(assets.jsPath, '/dist/index.mjs');
  assert.strictEqual(assets.dtsPath, '/dist/index.d.mts');
});

test('predictEmitPaths should correctly infer extension logic for ESM', () => {
  const result = core.predictEmitPaths('/work/src/index.mts', 'dist/index', '/work');
  // predictEmitPaths uses path.join and path.resolve, so slashes might be OS-specific
  assert.ok(result.jsPath.endsWith('index.mjs'));
  assert.ok(result.dtsPath.endsWith('index.d.mts'));
});

test('predictEmitPaths should correctly infer extension logic for private TS', () => {
  const result = core.predictEmitPaths('/work/src/myLib.c.ts', 'dist/myLib.c', '/work');
  assert.ok(result.jsPath.endsWith('myLib.c.js'));
  assert.ok(result.dtsPath.endsWith('myLib.c.d.ts'));
});

// Mock fs to test runMinimalValidation without physical files
const fs = require('fs');
test('runMinimalValidation should strip comments before checking emptiness', () => {
  const originalReadFileSync = fs.readFileSync;
  try {
    fs.readFileSync = () => `// todo: hacer algo\n/* empty */\n   \n\t`;
    const res1 = core.runMinimalValidation('/fake.ts');
    assert.strictEqual(res1.ok, false);
    assert.match(res1.reason, /comments or whitespace/);

    fs.readFileSync = () => `// todo\nexport type A = 1;\n`;
    const res2 = core.runMinimalValidation('/fake.ts');
    assert.strictEqual(res2.ok, true);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('prependWatermark works correctly', () => {
  const content = core.prependWatermark('const a = 1;', '../src/foo.mts');
  assert.match(content, /@generated/);
  assert.match(content, /DO NOT EDIT DIRECTLY/);
  assert.match(content, /foo\.mts/);
  assert.ok(content.endsWith('const a = 1;'));

  assert.strictEqual(core.prependWatermark('', '../src/foo.mts'), '');
});

['ts', 'mts'].forEach(ext => {
  ['.f.', '.forge.', '.source.'].forEach(suffixPrefix => {
    const fullSuffix = `${suffixPrefix}${ext}`;
    test(`predictEmitPaths generates correct extensions for ${fullSuffix}`, () => {
      const lockSuffixes = ['.f.ts', '.forge.ts', '.source.ts', '.f.mts', '.forge.mts', '.source.mts'];
      const resLocked = core.predictEmitPaths(`/src/myLib${fullSuffix}`, `dist/myLib`, `/work`, lockSuffixes);
      
      const expectedExt = ext.replace('ts', 'js');
      assert.ok(resLocked.jsPath.endsWith(`myLib.${expectedExt}`), `Failed for ${fullSuffix}: ${resLocked.jsPath}`);
      
      // Verify no duplicate suffix in the output
      assert.ok(!resLocked.jsPath.includes(suffixPrefix));
      assert.ok(!resLocked.dtsPath.includes(suffixPrefix));
    });
  });
});
