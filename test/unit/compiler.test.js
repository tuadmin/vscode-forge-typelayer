const assert = require('assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const core = require('../../src/core');

function createTempWorkspace() {
  const ws = path.join(__dirname, 'temp_ws_' + Date.now());
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

test('Integration: Internal API strictly compiles .f.ts to .js without .f. leak', async () => {
  const ws = createTempWorkspace();
  const entryAbs = path.join(ws, 'hola.f.ts');
  fs.writeFileSync(entryAbs, 'export const edad = 30;', 'utf8');

  // Use the internal typescript API to emit it
  const ts = require('typescript');
  const sourceText = fs.readFileSync(entryAbs, 'utf8');
  const config = new Map(); // simulated VS Code config map
  config.get = (key, def) => def; 
  
  // buildCompilerOptions inline (mocking extension.js)
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    declaration: true,
    emitDeclarationOnly: false,
    noEmitOnError: false, // pragmatic fallback
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    esModuleInterop: true,
    allowJs: true,
    checkJs: false
  };

  const host = ts.createCompilerHost(compilerOptions);
  const outputs = new Map();
  const originalReadFile = host.readFile.bind(host);
  host.readFile = (filePath) => path.resolve(filePath) === path.resolve(entryAbs) ? sourceText : originalReadFile(filePath);
  host.writeFile = (name, text) => outputs.set(path.resolve(name), text);

  const program = ts.createProgram([entryAbs], compilerOptions, host);
  program.emit();

  // Validate the in-memory output
  const assets = core.extractEmittedAssets(outputs);
  const paths = core.predictEmitPaths(entryAbs, 'hola.f.ts', ws); // simulated resolveOwningEntry fallback

  assert.ok(assets.jsContent, 'Should have emitted JS content');
  assert.ok(assets.dtsContent, 'Should have emitted Declarations');
  
  // Apply our watermark
  const jsRelSource = path.relative(path.dirname(paths.jsPath), entryAbs).replace(/\\/g, '/');
  const jsWatermarked = core.prependWatermark(assets.jsContent, jsRelSource);

  // Assertions!
  assert.strictEqual(path.basename(paths.jsPath), 'hola.js', 'Output should NOT have .f. lock in basename');
  assert.strictEqual(path.basename(paths.dtsPath), 'hola.d.ts', 'Output should NOT have .f. lock in basename');
  assert.match(jsWatermarked, /hola\.f\.ts/, 'Watermark must contain the relative reference to original lock file');

  // Clean
  fs.rmSync(ws, { recursive: true, force: true });
});

test('Integration: Internal API strictly compiles .mts keeping ESM standard', async () => {
    const ws = createTempWorkspace();
    const entryAbs = path.join(ws, 'hola.mts');
    fs.writeFileSync(entryAbs, 'export const speed = "light";', 'utf8');
  
    const ts = require('typescript');
    const sourceText = fs.readFileSync(entryAbs, 'utf8');
    
    const compilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      declaration: true,
      moduleResolution: ts.ModuleResolutionKind.Node16, // Use standard instead of bundler
      esModuleInterop: true,
      allowJs: true
    };
  
    const host = ts.createCompilerHost(compilerOptions);
    const outputs = new Map();
    host.readFile = (filePath) => path.resolve(filePath) === path.resolve(entryAbs) ? sourceText : ts.sys.readFile(filePath);
    host.writeFile = (name, text) => outputs.set(path.resolve(name), text);
  
    const program = ts.createProgram([entryAbs], compilerOptions, host);
    program.emit();
  
    const assets = core.extractEmittedAssets(outputs);
    const paths = core.predictEmitPaths(entryAbs, 'hola.mts', ws);
  
    assert.strictEqual(path.basename(paths.jsPath), 'hola.mjs', 'MTS must strictly emit MJS');
    assert.strictEqual(path.basename(paths.dtsPath), 'hola.d.mts', 'MTS must strictly emit D.MTS');
    assert.ok(assets.dtsContent, 'Declarations shouldn\'t be empty');
  
    fs.rmSync(ws, { recursive: true, force: true });
  });
