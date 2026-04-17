const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseHeaderManifest } = require('../../src/engine/manifest');

describe('Engine: Header Manifest Parser', () => {
  // Use os.tmpdir() so the file never lives in the test directory and can't
  // be committed or contaminate other test runs if afterEach doesn't fire.
  const tmpPath = path.join(os.tmpdir(), 'forge-test-manifest.ts');

  afterEach(() => {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  });

  it('correctly classifies inline vs external imports', () => {
    const code = `
      import { x } from './_pavo.ts';
      import { y } from '../_padre.ts';
      import * as z from './helpers/utils.js';
      import { w } from '../../public.ts';
      
      const logic = true;
      import { ignored } from './_ignored.ts'; // After logic starts, this is ignored
    `;
    fs.writeFileSync(tmpPath, code);

    const manifest = parseHeaderManifest(tmpPath);

    assert.strictEqual(manifest.hasImports, true);
    
    // Inlines: Starts with _ and is child/local -> ./_pavo.ts
    assert.strictEqual(manifest.inlines.length, 1);
    assert.strictEqual(manifest.inlines[0].raw, './_pavo.ts');
    assert.strictEqual(manifest.inlines[0].isTs, true);
    assert.strictEqual(manifest.inlines[0].normalized, './_pavo');

    // Externals: ../ or non-private 
    assert.strictEqual(manifest.externals.length, 3);
    const rawExternals = manifest.externals.map(e => e.raw);
    assert.ok(rawExternals.includes('../_padre.ts'));
    assert.ok(rawExternals.includes('./helpers/utils.js'));
    assert.ok(rawExternals.includes('../../public.ts'));
    
    // Ignored: Should not be in either because it's past the logic boundary
    assert.ok(!rawExternals.includes('./_ignored.ts'));
    assert.ok(!manifest.inlines.map(i=>i.raw).includes('./_ignored.ts'));
  });

  it('ignores strings that look like imports inside comments', () => {
    const code = `
      // import { fake } from './_fake.ts';
      /* import { block } from '../block.ts'; */
      export { real } from './_real.ts';
    `;
    fs.writeFileSync(tmpPath, code);

    const manifest = parseHeaderManifest(tmpPath);
    
    assert.strictEqual(manifest.inlines.length, 1);
    assert.strictEqual(manifest.inlines[0].raw, './_real.ts');
    assert.strictEqual(manifest.externals.length, 0);
  });
});
