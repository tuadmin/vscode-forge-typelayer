/**
 * engine.extractor.test.js
 * 
 * Tests for performExtraction() — the module that moves compiled files from the
 * shadow directory to the real workspace with correct naming.
 * 
 * Key invariant under test:
 *   Input (shadow) : private/algo.source.js  + private/algo.source.d.ts
 *   Output (target): private/algo.js         + private/algo.d.ts
 * 
 * The '.source.' infix is an AUTHORING convention and must be stripped on deploy.
 * This must hold regardless of which compiler was used (BUN, TSC, DENO, or none).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { describe, it, beforeEach, afterEach, mock } = require('bun:test');

// ─── VS Code FS Mock ──────────────────────────────────────────────────────────
// The extractor uses vscode.workspace.fs for all file I/O so it works inside
// the Extension Host. In tests we replace it with a Node.js fs shim.

mock.module('vscode', () => ({
    window: {
        showInformationMessage: () => {},
        showWarningMessage: () => {},
        showErrorMessage: () => {},
        createOutputChannel: () => ({ appendLine: () => {}, show: () => {} })
    },
    workspace: {
        fs: {
            stat: async (uri) => {
                if (!fs.existsSync(uri.fsPath)) throw new Error('ENOENT');
            },
            readFile: async (uri) => {
                return Buffer.from(fs.readFileSync(uri.fsPath));
            },
            writeFile: async (uri, data) => {
                fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
                fs.writeFileSync(uri.fsPath, Buffer.from(data));
            }
        }
    },
    Uri: {
        file: (p) => ({ fsPath: p })
    }
}));

const { performExtraction } = require('../../src/engine/extractor');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'forge-extractor-test-'));
}

/**
 * Creates an engineContext stub for a given compiler type.
 * @param {'bun'|'tsc'|'deno'|'none'} compilerType
 * @param {string} projectRoot
 * @param {string} shadowDir
 * @param {string[]} [lockSuffixes]
 */
function makeEngineCtx(compilerType, projectRoot, shadowDir, lockSuffixes) {
    const DEFAULT_LOCK_SUFFIXES = ['.f.ts', '.forge.ts', '.source.ts', '.f.mts', '.forge.mts', '.source.mts'];
    const commandMap = { bun: 'bun', tsc: 'tsc', deno: 'deno', none: null };
    
    // Strategy simulation for tests MUST MATCH context.js
    const STRATEGY = {
        FULL_BUNDLE: 'full_bundle',
        DOMAIN_BUNDLE: 'domain_bundle',
        RECURSIVE_PURE: 'recursive',
        STANDALONE: 'standalone'
    };

    return {
        projectRoot,
        shadowDir,
        lockSuffixes: lockSuffixes || DEFAULT_LOCK_SUFFIXES,
        activeCompiler: {
            type: compilerType === 'none' ? 'tsc' : compilerType,
            command: commandMap[compilerType]
        },
        getTscCommand: () => compilerType !== 'none' ? 'bun tsc' : null,
        // Mock the strategy
        currentBatchStrategy: (compilerType === 'tsc' || compilerType === 'deno') ? STRATEGY.RECURSIVE_PURE : STRATEGY.STANDALONE,
        getBuildStrategy: async () => {
            if (compilerType === 'tsc' || compilerType === 'deno') {
                return STRATEGY.RECURSIVE_PURE;
            }
            return STRATEGY.STANDALONE;
        },
        STRATEGY // Include for compatibility
    };
}

/**
 * Seeds the shadow directory simulating what each compiler type would produce
 * for a 'private/algo.source.ts' entry with one inline helper.
 * 
 * TSC / Deno produce: algo.source.js + algo.source.d.ts + _helper.js + _helper.d.ts (all individual)
 * Bun produces      : algo.source.js (bundled, inlines _helper) + algo.source.d.ts (TSC layer)
 */
function seedShadowForCompiler(shadowDir, compilerType) {
    fs.mkdirSync(path.join(shadowDir, 'private'), { recursive: true });

    // All compilers: TSC always runs first as the typing layer
    fs.writeFileSync(path.join(shadowDir, 'private', 'algo.source.js'), `// compiled JS for algo\nexport function algo() {}`);
    fs.writeFileSync(path.join(shadowDir, 'private', 'algo.source.d.ts'), `export declare function algo(): void;`);
    fs.writeFileSync(path.join(shadowDir, 'private', '_helper.d.ts'), `export declare const helper: string;`);

    if (compilerType === 'tsc' || compilerType === 'deno' || compilerType === 'none') {
        // TSC/Deno: also produce individual .js for helpers (no bundling)
        fs.writeFileSync(path.join(shadowDir, 'private', '_helper.js'), `export const helper = "helper";`);
    }
    // Bun: _helper.js is inlined into algo.source.js — no individual output
}

// ─── Constant: All canonical lock suffixes ────────────────────────────────────
// Must match the defaults in package.json and context._resolveLockSuffixes()
const CANONICAL_LOCK_SUFFIXES = ['.f.ts', '.forge.ts', '.source.ts', '.f.mts', '.forge.mts', '.source.mts'];

// ─── Manifest Fixtures ────────────────────────────────────────────────────────

const MANIFEST_WITH_INLINE = {
    hasImports: true,
    inlines: [{ raw: './_helper.ts', normalized: './_helper', isTs: true }],
    externals: []
};

const MANIFEST_EMPTY = { hasImports: false, inlines: [], externals: [] };

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Engine: Extractor — lock suffix output naming matrix', () => {
    let projectRoot;
    let shadowDir;

    beforeEach(() => {
        projectRoot = makeTempDir();
        shadowDir = makeTempDir();
    });

    afterEach(() => {
        fs.rmSync(projectRoot, { recursive: true, force: true });
        fs.rmSync(shadowDir, { recursive: true, force: true });
    });

    // ── Matrix: All lockSuffix conventions × all compiler types ───────────────
    // For each suffix, the shadow keeps the original infix name,
    // but the workspace target must always strip it to clean .js / .d.ts.

    const SUFFIX_CASES = [
        // .ts variants: shadow uses infix.d.ts, target uses .d.ts
        { suffix: '.source.ts', shadowJs: '.source.js', shadowDts: '.source.d.ts', targetJs: '.js', targetDts: '.d.ts' },
        { suffix: '.forge.ts',  shadowJs: '.forge.js',  shadowDts: '.forge.d.ts',  targetJs: '.js', targetDts: '.d.ts' },
        { suffix: '.f.ts',      shadowJs: '.f.js',      shadowDts: '.f.d.ts',      targetJs: '.js', targetDts: '.d.ts' },
        // .mts variants: TSC always emits .d.ts in shadow (not .d.mts), target is .d.mts
        { suffix: '.source.mts',shadowJs: '.source.mjs',shadowDts: '.source.d.ts', targetJs: '.mjs',targetDts: '.d.mts' },
        { suffix: '.forge.mts', shadowJs: '.forge.mjs', shadowDts: '.forge.d.ts',  targetJs: '.mjs',targetDts: '.d.mts' },
        { suffix: '.f.mts',     shadowJs: '.f.mjs',     shadowDts: '.f.d.ts',      targetJs: '.mjs',targetDts: '.d.mts' },
    ];

    for (const { suffix, shadowJs, shadowDts, targetJs, targetDts } of SUFFIX_CASES) {
        for (const compiler of ['bun', 'tsc', 'deno', 'none']) {
            it(`[${compiler.toUpperCase()}] algo${suffix} → algo${targetJs} + algo${targetDts}`, async () => {
                // Seed shadow as TSC would produce for this suffix
                fs.mkdirSync(path.join(shadowDir, 'private'), { recursive: true });
                fs.writeFileSync(path.join(shadowDir, 'private', `algo${shadowJs}`),  `// compiled`);
                fs.writeFileSync(path.join(shadowDir, 'private', `algo${shadowDts}`), `// types`);

                const entryFile = path.join(projectRoot, 'private', `algo${suffix}`);
                const engineCtx = makeEngineCtx(compiler, projectRoot, shadowDir, CANONICAL_LOCK_SUFFIXES);
                const manifestDataMap = { [entryFile]: MANIFEST_EMPTY };

                const extracted = await performExtraction(engineCtx, shadowDir, entryFile, manifestDataMap);

                // ✅ Target must have clean names (.js / .d.ts without the lock infix)
                assert.ok(fs.existsSync(path.join(projectRoot, 'private', `algo${targetJs}`)),
                    `[${compiler}][${suffix}] Expected algo${targetJs} in workspace`);
                assert.ok(fs.existsSync(path.join(projectRoot, 'private', `algo${targetDts}`)),
                    `[${compiler}][${suffix}] Expected algo${targetDts} in workspace`);

                // ❌ The infix version must NOT appear in the workspace
                const wrongJs  = path.join(projectRoot, 'private', `algo${shadowJs}`);
                const wrongDts = path.join(projectRoot, 'private', `algo${shadowDts}`);
                // Only flag as wrong if the shadow name differs from the target name
                if (shadowJs !== targetJs) {
                    assert.ok(!fs.existsSync(wrongJs),
                        `[${compiler}][${suffix}] algo${shadowJs} must NOT appear in workspace (lock infix must be stripped)`);
                }
                if (shadowDts !== targetDts) {
                    assert.ok(!fs.existsSync(wrongDts),
                        `[${compiler}][${suffix}] algo${shadowDts} must NOT appear in workspace`);
                }

                assert.ok(extracted >= 2, `Expected ≥2 extracted, got ${extracted}`);
            });
        }
    }

    // ── Regular .ts (no .source. convention) ─────────────────────────────────

    it('[TSC] regular module.ts → module.js + module.d.ts (no stripping needed)', async () => {
        fs.mkdirSync(path.join(shadowDir, 'lib'), { recursive: true });
        fs.writeFileSync(path.join(shadowDir, 'lib', 'module.js'),  `export function mod() {}`);
        fs.writeFileSync(path.join(shadowDir, 'lib', 'module.d.ts'), `export declare function mod(): void;`);

        const entryFile = path.join(projectRoot, 'lib', 'module.ts');
        const engineCtx = makeEngineCtx('tsc', projectRoot, shadowDir);
        const manifestDataMap = { [entryFile]: MANIFEST_EMPTY };

        await performExtraction(engineCtx, shadowDir, entryFile, manifestDataMap);

        assert.ok(fs.existsSync(path.join(projectRoot, 'lib', 'module.js')),  'module.js must exist');
        assert.ok(fs.existsSync(path.join(projectRoot, 'lib', 'module.d.ts')), 'module.d.ts must exist');
    });

    // ── Inline helper extraction by TSC/Deno ──────────────────────────────────

    it('[TSC] inline helper .d.ts is extracted alongside main file', async () => {
        seedShadowForCompiler(shadowDir, 'tsc');

        const entryFile = path.join(projectRoot, 'private', 'algo.source.ts');
        const engineCtx = makeEngineCtx('tsc', projectRoot, shadowDir);
        const manifestDataMap = { [entryFile]: MANIFEST_WITH_INLINE };

        const extracted = await performExtraction(engineCtx, shadowDir, entryFile, manifestDataMap);

        // TSC mode: extracts both .js and .d.ts for inlined helpers
        const helperJs  = path.join(projectRoot, 'private', '_helper.js');
        const helperDts = path.join(projectRoot, 'private', '_helper.d.ts');
        assert.ok(fs.existsSync(helperJs),  'TSC: inline helper .js must be extracted');
        assert.ok(fs.existsSync(helperDts), 'TSC: inline helper .d.ts must be extracted');
        assert.ok(extracted >= 4, `TSC: expected ≥4 files (main.js, main.d.ts, helper.js, helper.d.ts), got ${extracted}`);
    });

    it('[BUN] inline helper .d.ts is extracted but NOT .js (bundled inside main)', async () => {
        seedShadowForCompiler(shadowDir, 'bun');

        const entryFile = path.join(projectRoot, 'private', 'algo.source.ts');
        const engineCtx = makeEngineCtx('bun', projectRoot, shadowDir);
        const manifestDataMap = { [entryFile]: MANIFEST_WITH_INLINE };

        const extracted = await performExtraction(engineCtx, shadowDir, entryFile, manifestDataMap);

        // BUN mode: helper is inlined in the bundle, so only .d.ts is extracted for it
        const helperJs  = path.join(projectRoot, 'private', '_helper.js');
        const helperDts = path.join(projectRoot, 'private', '_helper.d.ts');
        assert.ok(!fs.existsSync(helperJs),  'BUN: inline helper .js must NOT be separately extracted (it was bundled)');
        assert.ok(fs.existsSync(helperDts), 'BUN: inline helper .d.ts must be extracted for type resolution');
        assert.ok(extracted >= 3, `BUN: expected ≥3 files (main.js, main.d.ts, helper.d.ts), got ${extracted}`);
    });

    // ── Zero extraction scenario ───────────────────────────────────────────────

    it('returns 0 when shadow directory is empty (build failed silently)', async () => {
        // Shadow is empty — nothing was compiled
        const entryFile = path.join(projectRoot, 'private', 'algo.source.ts');
        const engineCtx = makeEngineCtx('tsc', projectRoot, shadowDir);
        const manifestDataMap = { [entryFile]: MANIFEST_EMPTY };

        const extracted = await performExtraction(engineCtx, shadowDir, entryFile, manifestDataMap);
        assert.strictEqual(extracted, 0, 'Should return 0 when no shadow files exist');
    });
});

// ─── Suite: lockSuffix runtime validation ─────────────────────────────────────
// Tests the _resolveLockSuffixes() guard that runs INSIDE the engine context.
// This is the second layer after the JSON Schema in package.json.
//
// The same VALID_PATTERN = /^\.\w[\w.]*\.m?ts$/ must hold in both places.

describe('Engine: Extractor — lockSuffix custom convention stripping', () => {
    let projectRoot;
    let shadowDir;

    beforeEach(() => { projectRoot = makeTempDir(); shadowDir = makeTempDir(); });
    afterEach(() => {
        fs.rmSync(projectRoot, { recursive: true, force: true });
        fs.rmSync(shadowDir, { recursive: true, force: true });
    });

    it('accepts a user-defined valid custom suffix (.widget.ts)', async () => {
        fs.mkdirSync(path.join(shadowDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(shadowDir, 'src', 'btn.widget.js'),  `// compiled`);
        fs.writeFileSync(path.join(shadowDir, 'src', 'btn.widget.d.ts'), `// types`);

        const entryFile = path.join(projectRoot, 'src', 'btn.widget.ts');
        const engineCtx = makeEngineCtx('tsc', projectRoot, shadowDir, ['.widget.ts']);
        await performExtraction(engineCtx, shadowDir, entryFile, { [entryFile]: MANIFEST_EMPTY });

        assert.ok(fs.existsSync(path.join(projectRoot, 'src', 'btn.js')),
            'Custom suffix .widget.ts → btn.js must be stripped correctly');
        assert.ok(!fs.existsSync(path.join(projectRoot, 'src', 'btn.widget.js')),
            'btn.widget.js must NOT exist in workspace (lock infix stripped)');
    });

    // ── Pattern validation (tests the VALID_PATTERN rule) ────────────────────
    // These validate the regex constraint: /^\.\w[\w.]*\.m?ts$/
    // We test the pattern directly since _resolveLockSuffixes() is on context.js
    // which requires vscode; we validate it through the extractor behavior.

    const VALID_SUFFIXES = ['.source.ts', '.forge.ts', '.f.ts', '.source.mts', '.my.custom.ts', '.x.ts'];
    const INVALID_SUFFIXES = [
        '.source.js',    // JS output — not an authoring suffix
        '.source.jsx',   // React — not TS
        'source.ts',     // Missing leading dot
        '.ts',           // No infix — bare .ts not a lock suffix
        '.source.',      // No extension at end
        '',             // Empty
        '.source.tsx',   // TSX — not currently supported (no TSX→JSX mapping)
    ];

    const VALID_PATTERN = /^\.\w[\w.]*\.m?ts$/;

    for (const suffix of VALID_SUFFIXES) {
        it(`pattern accepts valid suffix "${suffix}"`, () => {
            assert.ok(VALID_PATTERN.test(suffix), `"${suffix}" should be a valid lockSuffix`);
        });
    }

    for (const suffix of INVALID_SUFFIXES) {
        it(`pattern rejects invalid suffix "${JSON.stringify(suffix)}"`, () => {
            assert.ok(!VALID_PATTERN.test(suffix), `"${suffix}" should be REJECTED as a lockSuffix`);
        });
    }
});

