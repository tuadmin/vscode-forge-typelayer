const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { describe, it, beforeEach, afterEach, mock } = require('bun:test');

// Mock VS Code
mock.module('vscode', () => ({
    window: {
        showInformationMessage: () => {},
        showWarningMessage: () => {},
        showErrorMessage: () => {},
        createOutputChannel: () => ({ appendLine: () => {}, show: () => {} })
    },
    workspace: {
        fs: {
            stat: async (uri) => { if (!fs.existsSync(uri.fsPath)) throw new Error('ENOENT'); },
            readFile: async (uri) => Buffer.from(fs.readFileSync(uri.fsPath)),
            writeFile: async (uri, data) => {
                fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
                fs.writeFileSync(uri.fsPath, Buffer.from(data));
            }
        },
        getConfiguration: () => ({
            get: (key, defaultValue) => defaultValue
        })
    },
    Uri: { file: (p) => ({ fsPath: p }) },
    ConfigurationTarget: { Workspace: 1 }
}));

const { performExtraction } = require('../../src/engine/extractor');
const { parseHeaderManifest } = require('../../src/engine/manifest');

describe('Structural Fidelity - Baseline Regression', () => {
    let tmpDir;
    let shadowDir;
    const baselinesDir = path.join(__dirname, '../../test-fixtures/baselines');

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-baselines-'));
        shadowDir = path.join(tmpDir, '.shadow');
        fs.mkdirSync(shadowDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function runBaseline(caseName, strategy, expectedFolder) {
        const baselineSource = path.join(baselinesDir, 'cases', `${caseName}.ts`);
        const expectedPath = path.join(baselinesDir, 'expectations', expectedFolder, `${caseName}.js`);
        
        assert.ok(fs.existsSync(baselineSource), `Case file missing: ${baselineSource}`);
        assert.ok(fs.existsSync(expectedPath), `Expectation file missing: ${expectedPath}`);

        // IMPORTANT: Copy to tmpDir to simulate local workspace file
        const projectSource = path.join(tmpDir, `${caseName}.ts`);
        fs.copyFileSync(baselineSource, projectSource);

        const manifest = parseHeaderManifest(projectSource);
        
        // Mock the build results in shadow (relative to entry inside project)
        const shadowJsPath = path.join(shadowDir, `${caseName}.js`);
        const expectedJs = fs.readFileSync(expectedPath, 'utf8');
        
        fs.mkdirSync(path.dirname(shadowJsPath), { recursive: true });
        fs.writeFileSync(shadowJsPath, expectedJs);

        // Run extraction
        const forgeCtx = {
            projectRoot: tmpDir,
            lockSuffixes: ['.f.ts', '.forge.ts', '.source.ts'], 
            addWatermark: false,
            STRATEGY: { STANDALONE: 'standalone', FULL_BUNDLE: 'full_bundle' }
        };

        const manifestMap = { [projectSource]: manifest };
        await performExtraction(forgeCtx, shadowDir, projectSource, manifestMap, strategy);

        // Compare results
        const resultPath = path.join(tmpDir, `${caseName}.js`);
        assert.ok(fs.existsSync(resultPath), `Resulting JS should exist at ${resultPath}`);
        
        const resultContent = fs.readFileSync(resultPath, 'utf8').trim();
        const goldContent = expectedJs.trim();
        
        const normalizedResult = resultContent.replace(/\r\n/g, '\n');
        const normalizedGold = goldContent.replace(/\r\n/g, '\n');

        assert.strictEqual(normalizedResult, normalizedGold, `Structural mismatch in ${caseName} for ${expectedFolder}`);
    }

    it('TSC: Matches structural-fidelity.js baseline exactly', async () => {
        await runBaseline('structural-fidelity', 'standalone', 'tsc');
    });
});
