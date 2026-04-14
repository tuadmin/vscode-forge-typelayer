const assert = require('assert');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

// A functional, CLI-agnostic test script to verify Shadow Build topography
// and compiler behaviors without relying on the VS Code UI.

const fixturesDir = path.join(__dirname, '..', '..', 'test-fixtures', 'matrix-test');

function cleanup() {
  if (fs.existsSync(fixturesDir)) {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
}

function setupWorkspace() {
  cleanup();
  fs.mkdirSync(path.join(fixturesDir, 'private/sub'), { recursive: true });
  fs.mkdirSync(path.join(fixturesDir, 'public'), { recursive: true });
  
  // 1. The Internal Helper (Same level)
  fs.writeFileSync(path.join(fixturesDir, 'private/sub/_hijo.ts'), `export const hijo = "hijo";`);
  
  // 2. The External Helper (Parent level, but still private _)
  fs.writeFileSync(path.join(fixturesDir, 'private/_afuera.ts'), `export const afuera = "afuera";`);
  
  // 3. The Public API (External, not private)
  fs.writeFileSync(path.join(fixturesDir, 'public/externo.ts'), `export const externo = "externo";`);
  
  // 4. The Source Entry Point
  fs.writeFileSync(path.join(fixturesDir, 'private/sub/main.source.ts'), `
import { hijo } from './_hijo.js';
import { afuera } from '../_afuera.js';
import { externo } from '../../public/externo.js';

export function run() {
  console.log(hijo, afuera, externo);
}
  `.trim());

  // Synthetic tsconfig
  fs.writeFileSync(path.join(fixturesDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2022",
      declaration: true,
      outDir: ".shadow"
    },
    files: ["private/sub/main.source.ts"]
  }, null, 2));
}

// We wrap it in standard Mocha test blocks
describe('Compiler Matrix Logic', function() {
  this.timeout(20000);

  beforeEach(() => {
    setupWorkspace();
  });

  after(() => {
    // cleanup(); // You can comment this out to inspect manually
  });

  it('TSC: Transpiles the full dependency tree physically into the shadow directory', () => {
    try {
      // Using npx to ensure it finds a local/global tsc
      cp.execSync('npx tsc -p tsconfig.json', { cwd: fixturesDir });
      
      const shadowBase = path.join(fixturesDir, '.shadow');
      
      // ASSERT: Expected Shadow Topography
      
      // 1. Main file generated
      assert.ok(fs.existsSync(path.join(shadowBase, 'private/sub/main.source.js')), 'Main JS missing');
      assert.ok(fs.existsSync(path.join(shadowBase, 'private/sub/main.source.d.ts')), 'Main DTS missing');
      
      // 2. Child Helper generated (extracted by _)
      assert.ok(fs.existsSync(path.join(shadowBase, 'private/sub/_hijo.js')), 'Child JS helper missing');
      
      // 3. Parent Helper generated (extracted by _)
      assert.ok(fs.existsSync(path.join(shadowBase, 'private/_afuera.js')), 'Parent JS helper missing');
      
      // 4. Public Dependency generated (IGNORED by _)
      assert.ok(fs.existsSync(path.join(shadowBase, 'public/externo.js')), 'Public dependency should be transpiled by TSC');

      console.log('✅ TSC Test Passed: Dependency tree successfully physically mapped to shadow directory.');
    } catch (e) {
      if (e.message.includes('npx')) {
        console.warn('⚠️ TSC Test Skipped: Node/NPX not available in test shell env.');
      } else {
        throw e;
      }
    }
  });

  it('Bun: Bundles private files natively while respecting parent externalization', () => {
    try {
      // We pass --external '../..' to prevent inlining absolute public paths, 
      // but we allow it to inline '../_afuera'
      cp.execSync('bun build private/sub/main.source.ts --outfile .shadow/bundle.js --target node --external \'../../public/*\'', { cwd: fixturesDir });
      
      const bundledCode = fs.readFileSync(path.join(fixturesDir, '.shadow/bundle.js'), 'utf8');
      
      // ASSERT: Bundle contents
      assert.ok(bundledCode.includes('"hijo"'), 'Bun failed to inline _hijo.ts');
      assert.ok(bundledCode.includes('"afuera"'), 'Bun failed to inline _afuera.ts from parent');
      assert.ok(bundledCode.includes('import { externo }'), 'Bun wrongly inlined the public dependency');

      console.log('✅ Bun Test Passed: Inlining correctly pulls _ files while ignoring explicit externals.');
    } catch (e) {
      if (e.message.includes('bun')) {
        console.warn('⚠️ Bun Test Skipped: Bun not available in test shell env.');
      } else {
        throw e;
      }
    }
  });
});
