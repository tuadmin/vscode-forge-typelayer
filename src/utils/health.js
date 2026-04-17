const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { SYSTEM_CAPABILITIES, fileExists, COMPATIBILITY_REGISTRY, isVersionAtLeast } = require('../core');
const { t } = require('./i18n');
const { logger } = require('./logger');

const GLOBAL_HEALTH_KEY = 'forgeTypeLayer.health.binaries';
const WORKSPACE_HEALTH_KEY = 'forgeTypeLayer.health.filesystem';

/**
 * Validates the environment health and persists results.
 */
async function validateEnvironment(vscContext, workspacePath, activeCompiler, shadowDir) {
    const results = {
        binary: await checkBinaryHealth(vscContext, activeCompiler),
        filesystem: await checkFileSystemHealth(vscContext, workspacePath, shadowDir)
    };

    const isHealthy = results.binary.ok && results.filesystem.ok;
    if (!isHealthy) {
        logger.error('--- Pre-flight Validation Failed ---');
        if (!results.binary.ok) logger.error(`[Health] Binary Error: ${results.binary.error}`);
        if (!results.filesystem.ok) logger.error(`[Health] Filesystem Error: ${results.filesystem.error}`);
        logger.show();
    } else {
        logger.debug('[Health] Pre-flight validation passed.');
        if (results.binary.outdated) {
            const { type, version, minimum } = results.binary;
            logger.warn(t('warn.outdatedBinary', type, version, minimum));
        }
    }

    return results;
}

/**
 * Checks if a binary is functional and caches the result globally.
 */
async function checkBinaryHealth(context, compiler) {
    if (!compiler.command) return { ok: false, error: 'No compiler command defined' };

    const globalState = context.globalState;
    const cacheKey = `${GLOBAL_HEALTH_KEY}.${compiler.type}.${compiler.command}`;
    const cached = globalState.get(cacheKey);

    // If already validated in this installation, skip heavy check
    if (cached?.ok && cached.version) {
        return { ok: true, version: cached.version };
    }

    try {
        const cmd = SYSTEM_CAPABILITIES.versionCmd(compiler.command);
        const version = cp.execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }).trim();
        
        const minimum = COMPATIBILITY_REGISTRY[compiler.type];
        const isCompatible = isVersionAtLeast(version, minimum);

        const result = { ok: true, version, outdated: !isCompatible, minimum, timestamp: Date.now() };
        globalState.update(cacheKey, result);
        return result;
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Checks if the shadow directory is writable and caches result per workspace.
 */
async function checkFileSystemHealth(context, workspacePath, shadowDir) {
    const workspaceState = context.workspaceState;
    const cacheKey = `${WORKSPACE_HEALTH_KEY}.${workspacePath}`;
    const cached = workspaceState.get(cacheKey);

    if (cached?.ok && cached.path === shadowDir) {
        return { ok: true };
    }

    try {
        // Ensure shadow directory itself exists
        if (!fileExists(shadowDir)) {
            fs.mkdirSync(shadowDir, { recursive: true });
        }

        const testFile = path.join(shadowDir, `.forge-health-${Date.now()}.tmp`);
        fs.writeFileSync(testFile, 'health-check');
        fs.unlinkSync(testFile);

        const result = { ok: true, path: shadowDir, timestamp: Date.now() };
        workspaceState.update(cacheKey, result);
        return result;
    } catch (err) {
        return { ok: false, error: `Write access denied to ${shadowDir}. ${err.message}` };
    }
}

/**
 * Clears health cache (useful for 'Doctor' or forced re-validation).
 */
function clearCache(context) {
    // We can't easily iterate globalState keys, but we can clear specific ones or use a version prefix
    // For now, we manually clear if needed.
}

module.exports = {
    validateEnvironment,
    checkBinaryHealth,
    checkFileSystemHealth
};
