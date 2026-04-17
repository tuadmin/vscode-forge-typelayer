const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const { parseHeaderManifest } = require('./manifest');
const { buildWithCompiler } = require('./builder');
const { performExtraction } = require('./extractor');
const { logger } = require('../utils/logger');
const { t } = require('../utils/i18n');

let pendingBatch = new Set();
let emitTimeout = null;

// Global flag to track if we've already done the gitignore check this session
let gitignoreChecked = false;

async function promptGitignore(forgeContext) {
    if (gitignoreChecked) return;
    gitignoreChecked = true;

    const gitignorePath = path.join(forgeContext.projectRoot, '.gitignore');
    const targetLine = '.vscode/forge-temp/';

    let exists = false;
    let content = '';

    if (fs.existsSync(gitignorePath)) {
        content = fs.readFileSync(gitignorePath, 'utf8');
        exists = content.includes(targetLine);
    }

    if (!exists) {
        const choice = await vscode.window.showInformationMessage(
            t('prompt.gitignore'),
            t('prompt.gitignore.yes'),
            t('prompt.gitignore.no')
        );

        if (choice === t('prompt.gitignore.yes')) {
            const newContent = content + (content.endsWith('\n') || content === '' ? '' : '\n') + targetLine + '\n';
            fs.writeFileSync(gitignorePath, newContent);
            logger.info(t('info.gitignoreAdded'));
        }
    }
}

/**
 * Validates if the file is a target of interest.
 */
function isTargetFile(filename) {
    const ext = path.extname(filename);
    if (!['.ts', '.js', '.mts', '.mjs', '.cts', '.cjs'].includes(ext)) return false;
    if (filename.includes('.d.ts') || filename.includes('.d.mts') || filename.includes('.d.cts')) return false;
    
    // We only trigger builds directly from explicit trigger patterns 
    // or generic root-like handlers if the context allows.
    // For now we trust the watcher filtered it.
    return true;
}

/**
 * Main entry point for file saves.
 */
function scheduleEmission(document, forgeContext) {
    logger.debug(`scheduleEmission called for: ${document.fileName}`);

    if (!forgeContext.isHealthy) {
        const h = forgeContext.healthInfo;
        const msg = !h.binary.ok 
            ? t('error.preflight.binary', forgeContext.activeCompiler.command)
            : t('error.preflight.filesystem', forgeContext.shadowDir);
        
        logger.error(`❌ CANNOT EMIT: ${msg}`);
        vscode.window.showErrorMessage(`Forge TypeLayer: ${msg}`);
        return;
    }

    logger.debug(`activeCompiler: type=${forgeContext.activeCompiler?.type}, command=${forgeContext.activeCompiler?.command}`);
    logger.debug(`projectRoot: ${forgeContext.projectRoot}`);

    if (!forgeContext.activeCompiler.command && forgeContext.activeCompiler.type !== 'tsc') {
        const fallback = forgeContext.getTscCommand();
        logger.debug(`No compiler command, TSC fallback: ${fallback}`);
        if (!fallback) {
            logger.warn(t('error.binaryNotFound'));
            return;
        }
    }

    const filename = document.fileName;
    if (!isTargetFile(filename)) {
        logger.debug(`Rejected by isTargetFile filter: ${filename}`);
        return;
    }

    pendingBatch.add(filename);
    logger.debug(`Added to batch (size: ${pendingBatch.size}): ${filename}`);

    if (emitTimeout) clearTimeout(emitTimeout);

    emitTimeout = setTimeout(async () => {
        const filesToEmit = Array.from(pendingBatch);
        pendingBatch.clear();

        if (filesToEmit.length > 0) {
            logger.debug(`Debounce fired — executing batch of ${filesToEmit.length} files`);
            await executeBatch(filesToEmit, forgeContext);
        }
    }, 300); // 300ms debounce window
}

async function executeBatch(files, forgeContext) {
    // shadowDir is pre-resolved in context.resolveEngineContext() based on workspace type
    const shadowDir = forgeContext.shadowDir;
    logger.debug(`Shadow directory: ${shadowDir}`);
    
    // Guardian Check
    await promptGitignore(forgeContext);
    
    logger.info(t('info.batchStarted'));
    logger.info(t('info.compiling', files.length));
    
    const startBuild = Date.now();

    // 1. Scan headers for the smart manifest bounds
    const manifestDataMap = {};
    let needsStrategySelection = false;
    let fileWithInlines = null;

    files.forEach(f => {
        manifestDataMap[f] = parseHeaderManifest(f);
        const m = manifestDataMap[f];
        logger.debug(`Manifest for ${path.basename(f)}: hasImports=${m.hasImports}, isPure=${m.isPure}, inlines=${m.inlines.length}, externals=${m.externals.length}`);
        
        if (m.inlines.length > 0) {
            needsStrategySelection = true;
            fileWithInlines = f;
        }
    });

    // 2. Resolve or Prompt Strategy
    let strategy = forgeContext.buildStrategy;
    
    // If we have inlines but strategy is still the default (standalone) and we haven't asked, ask.
    const ForgeContext = require('../context');
    if (needsStrategySelection && strategy === ForgeContext.STRATEGY.STANDALONE) {
        strategy = await promptBuildStrategy(fileWithInlines, forgeContext);
    }
    
    // Attach the resolved strategy to the engine context for this batch
    forgeContext.currentBatchStrategy = strategy;

    // Per-file Strategy refinement: Pure files ALWAYS use STANDALONE for purity/fidelity.
    const fileStrategies = {};
    files.forEach(f => {
        const m = manifestDataMap[f];
        fileStrategies[f] = m.isPure ? ForgeContext.STRATEGY.STANDALONE : strategy;
    });

    try {
        // 3. Build via the unified Builder (TSC + Bun/Deno)
        logger.debug(`Building with compiler type=${forgeContext.activeCompiler.type}...`);
        await buildWithCompiler(forgeContext, shadowDir, files, manifestDataMap, fileStrategies);
        logger.debug(`Build phase completed successfully`);
        
        // Dump what TSC actually produced in the shadow
        const shadowFiles = listShadowContents(shadowDir);
        logger.debug(`Shadow contents after build (${shadowFiles.length} files):`);
        shadowFiles.forEach(f => logger.debug(`  📄 ${f}`));

        let totalExtracted = 0;
        
        for (const f of files) {
            logger.debug(`--- Extracting for entry: ${path.basename(f)} ---`);
            const extracted = await performExtraction(forgeContext, shadowDir, f, manifestDataMap, fileStrategies[f]);
            logger.debug(`Extracted ${extracted} files for ${path.basename(f)}`);
            totalExtracted += extracted;
        }

        const elapsed = Date.now() - startBuild;
        logger.info(t('success.extracted', totalExtracted, elapsed));
        
        if (totalExtracted === 0) {
            logger.warn(t('warn.zeroExtracted'));
            logger.show();
        }
    } catch (e) {
        logger.error(t('error.batchFailed'), e);
        vscode.window.showErrorMessage(t('error.batchMessage', e.message));
    }
}

/**
 * Lists all files recursively inside a directory (for debug purposes).
 */
function listShadowContents(dir) {
    const results = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...listShadowContents(fullPath));
            } else {
                results.push(path.relative(dir, fullPath));
            }
        }
    } catch { /* shadow may not exist yet */ }
    return results;
}

/**
 * Shows a VS Code prompt to select a build strategy when inlines are detected.
 */
async function promptBuildStrategy(fileName, forgeContext) {
    const ForgeContext = require('../context');
    const hasBun = forgeContext.activeCompiler.type === 'bun';
    
    const options = [];
    if (hasBun) {
        options.push({ label: t('prompt.strategy.full'), value: ForgeContext.STRATEGY.FULL_BUNDLE });
        options.push({ label: t('prompt.strategy.domain'), value: ForgeContext.STRATEGY.DOMAIN_BUNDLE });
    }
    options.push({ label: t('prompt.strategy.recursive'), value: ForgeContext.STRATEGY.RECURSIVE_PURE });
    options.push({ label: t('prompt.strategy.standalone'), value: ForgeContext.STRATEGY.STANDALONE });

    const picked = await vscode.window.showInformationMessage(
        t('prompt.strategy.title', path.basename(fileName)),
        ...options.map(o => o.label)
    );

    if (!picked) return ForgeContext.STRATEGY.STANDALONE;
    
    const choice = options.find(o => o.label === picked).value;
    
    // Persist choice for the workspace
    await forgeContext.setBuildStrategy(forgeContext.projectRoot, choice);
    
    return choice;
}

module.exports = {
    scheduleEmission,
    /** FOR TESTING ONLY: cancels any pending debounce timer so no async work fires after test suite ends. */
    resetDebounce() {
        if (emitTimeout) { clearTimeout(emitTimeout); emitTimeout = null; }
        pendingBatch.clear();
        gitignoreChecked = false;
    }
};
