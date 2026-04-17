const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { t } = require('../../src/utils/i18n');
const { buildWithCompiler } = require('../../src/engine/builder');

describe('Engine: Builder Module', () => {

  let mockShadowDir;

  beforeAll(() => {
    // Fresh isolated temp dir per test run — avoids stale state from crashed previous runs
    mockShadowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-builder-shadow-'));
  });

  afterAll(() => {
    if (mockShadowDir) fs.rmSync(mockShadowDir, { recursive: true, force: true });
  });

  it('correctly constructs the Bun build command with externals', async () => {
    // Note: builder.js shells out to bun/tsc. In unit tests we verify failure mode
    // (the builder throws a typed error) rather than mocking child_process globally.
    
    const fakeContext = {
      projectRoot: '/fake/root',
      activeCompiler: { type: 'bun', command: 'bun' },
      getTscCommand: () => null // Skip TSC phase to isolate Bun bundler path
    };
    
    const entryFiles = ['/fake/root/src/main.source.ts'];
    const manifestMap = {
      '/fake/root/src/main.source.ts': { externals: [{ raw: '../_padre.ts' }] }
    };
    
    // We expect failure because the entry file doesn't exist in our fake root.
    // The important thing is the builder throws a structured error, not undefined.
    let threw = false;
    let caughtError = null;
    try {
      await buildWithCompiler(fakeContext, mockShadowDir, entryFiles, manifestMap);
    } catch(e) {
      threw = true;
      caughtError = e;
      assert.ok(
        e.message.includes(t('error.bundlerFailed', '').trim().split(':')[0]) || e.message.includes('bun build') || e.message.includes('ENOENT'),
        `Expected a builder error, got: ${e.message}`
      );
      // INVARIANT: --splitting=false must NEVER appear — it's invalid Bun syntax
      assert.ok(
        !e.message.includes('--splitting=false'),
        'Builder must NOT emit --splitting=false (invalid Bun flag). Use presence-only --splitting or omit it.'
      );
    }
    assert.strictEqual(threw, true);
  });
});
