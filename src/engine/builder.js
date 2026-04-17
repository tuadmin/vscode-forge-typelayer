const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const execPromise = util.promisify(cp.exec);
const { t } = require('../utils/i18n');
const shell = require('../utils/shell');

/**
 * Builds the dynamic TSConfig for the Virtual Space to enable Incremental Caching.
 */
function createShadowTsConfig(outDir, entryFiles, projectRoot) {
    const tsconfig = {
        compilerOptions: {
            rootDir: projectRoot,
            target: "ESNext",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            declaration: true,
            emitDeclarationOnly: false,
            outDir: "./",
            allowJs: true,
            strict: false,
            skipLibCheck: true,
            incremental: true,
            tsBuildInfoFile: "./.tsbuildinfo"
        },
        files: entryFiles
    };

    fs.writeFileSync(path.join(outDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
}

/**
 * Orchestrates the Hybrid Sandboxed Build Pipeline.
 * 1. Runs TSC (Incremental) to compile the full AST dependency tree.
 * 2. Runs Bun/Deno to perform fast tight-bundling using Manifest constraints.
 */
async function buildWithCompiler(forgeContext, shadowDir, entryFiles, manifestDataMap, fileStrategies = {}) {
    if (!fs.existsSync(shadowDir)) {
        fs.mkdirSync(shadowDir, { recursive: true });
    }

    // 1. TSC Layer: Full Tree Generation (Incremental for speed)
    createShadowTsConfig(shadowDir, entryFiles, forgeContext.projectRoot);

    const tscCmd = forgeContext.getTscCommand();
    if (tscCmd) {
        try {
            const configPath = shell.quoteArg(path.join(shadowDir, 'tsconfig.json'));
            await execPromise(`${tscCmd} -p ${configPath}`, { cwd: shadowDir });
        } catch (e) {
            // TSC errors might exist but it still emits parts of the tree
        }
    }

    const { type: cmpType, command } = forgeContext.activeCompiler;
    const ForgeContext = require('../context');

    const promises = entryFiles.map(entry => {
        const strategy = fileStrategies[entry] || forgeContext.currentBatchStrategy;

        // Skip if in RECURSIVE or STANDALONE modes to maintain TSC purity for this specific file.
        if ((cmpType === 'bun' || cmpType === 'deno') && 
            strategy !== ForgeContext.STRATEGY.RECURSIVE_PURE && 
            strategy !== ForgeContext.STRATEGY.STANDALONE) {

            const relEntry = path.relative(forgeContext.projectRoot, entry);
            const shadowTarget = path.join(shadowDir, relEntry).replace(/\.m?ts$/, (m) => m === '.mts' ? '.mjs' : '.js');
            fs.mkdirSync(path.dirname(shadowTarget), { recursive: true });

            let cmdStr = '';
            if (cmpType === 'bun') {
                const manifest = manifestDataMap[entry] || { externals: [] };
                let extArgs = '';
                if (strategy === ForgeContext.STRATEGY.FULL_BUNDLE) {
                    extArgs = ''; 
                } else {
                    extArgs = manifest.externals.length > 0
                        ? manifest.externals.map(ext => `--external ${shell.quoteArg(ext.raw)}`).join(' ')
                        : `--external ${shell.quoteArg('../*')}`; 
                }

                const quotedEntry = shell.quoteArg(relEntry);
                const quotedOut   = shell.quoteArg(shadowTarget);
                cmdStr = `${command} build ${quotedEntry} --outfile=${quotedOut} --target=node --format=esm ${extArgs}`;
            } else if (cmpType === 'deno') {
                return Promise.resolve(); // TSC already handled Deno fallback
            }

            if (!cmdStr) return Promise.resolve();

            const { logger } = require('../utils/logger');
            logger.info(`[Builder] Running: ${cmdStr}`);
            return execPromise(cmdStr, { cwd: forgeContext.projectRoot }).then(out => {
                if (out.stdout) logger.info(`[Builder] stdout: ${out.stdout}`);
                if (out.stderr) logger.info(`[Builder] stderr: ${out.stderr}`);
            }).catch(err => {
                logger.error(`[Builder] COMMAND FAILED: ${cmdStr}`);
                logger.error(`[Builder] Error: ${err.message}`);
                throw new Error(t('error.bundlerFailed', err.message));
            });
        }
        
        return Promise.resolve(); // Pure files or non-bundler strategies
    });

    await Promise.all(promises);
}

module.exports = {
    buildWithCompiler
};
