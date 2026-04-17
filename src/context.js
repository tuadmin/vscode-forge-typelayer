const vscode = require('vscode');
const path = require('path');
const os = require('os');
const core = require('./core');
const { t } = require('./utils/i18n');
const health = require('./utils/health');

class ForgeContext {
  constructor() {
    this.runtimes = new Map(); // workspaceFSPath -> { runtime, hints, reason }
    this.aliases  = new Map(); // workspaceFSPath -> alias object
    this.tempDirs = new Set(); // temp shadow dirs created for loose-folder mode — cleaned on deactivate
    this.healthStatus = new Map(); // workspaceFSPath -> { binary: {ok, error}, filesystem: {ok, error} }
    this.vscContext = null;    // Storage for the extension context (for workspaceState)
    
    // Build Strategies
    this.STRATEGY = {
      FULL_BUNDLE: 'full_bundle',     // Bun: All-in-one
      DOMAIN_BUNDLE: 'domain_bundle', // Bun: Bundle inlines, keep externals separate (Hybrid)
      RECURSIVE_PURE: 'recursive',    // TSC/Bun: Everything 1:1, preserves const/comments
      STANDALONE: 'standalone'        // Only the entry file
    };
  }

  /** Sets the global extension context. */
  setExtensionContext(context) {
    this.vscContext = context;
  }

  /**
   * Initializes or refreshes the cached state for a workspace.
   * Scans for binaries, parses configs, and saves to memory.
   */
  async initializeWorkspace(workspacePath, config) {
    // 1. Resolve runtime once
    const preferred = config.get('preferredRuntime', 'auto');
    const runtime = core.resolveRuntimePreference({ workspacePath, preferredRuntime: preferred });
    this.runtimes.set(workspacePath, runtime);

    const aliases = core.extractAliases(workspacePath);
    this.aliases.set(workspacePath, aliases);

    // 3. Pre-flight health check (proactive)
    const engineCtx = this.resolveEngineContext(workspacePath);
    const healthResult = await health.validateEnvironment(this.vscContext, workspacePath, engineCtx.activeCompiler, engineCtx.shadowDir);
    this.healthStatus.set(workspacePath, healthResult);

    return { runtime, aliases, health: healthResult };
  }

  /**
   * Retrieves the cached runtime evaluation for the workspace.
   */
  getRuntime(workspacePath) {
    return this.runtimes.get(workspacePath);
  }

  /**
   * Retrieves the cached aliases for the workspace.
   */
  getAliases(workspacePath) {
    return this.aliases.get(workspacePath) || { paths: {}, imports: {}, baseUrl: '.' };
  }

  /**
   * Checks if the user has acknowledged the TSC fallback warning.
   */
  hasTscConsent(workspacePath) {
    const config = vscode.workspace.getConfiguration('forgeTypeLayer', vscode.Uri.file(workspacePath));
    return config.get('tscConsent', false);
  }

  /**
   * Saves the user's consent for TSC fallback to the workspace settings.
   */
  async grantTscConsent(workspacePath) {
    const config = vscode.workspace.getConfiguration('forgeTypeLayer', vscode.Uri.file(workspacePath));
    // Save to Workspace target (.vscode/settings.json)
    await config.update('tscConsent', true, vscode.ConfigurationTarget.Workspace);
  }

  /**
   * Resolves a flat "engine context" object for a specific workspace.
   * This is the BRIDGE between the Map-based singleton and what 
   * batchOrchestrator/builder/extractor expect as their `forgeContext` param.
   * 
   * @param {string} workspacePath - Absolute path to the workspace root
   * @returns {{ projectRoot: string, activeCompiler: { type: string, command: string|null }, getTscCommand: () => string|null }}
   */
  resolveEngineContext(workspacePath) {
    const runtimeInfo = this.getRuntime(workspacePath) || { runtime: 'tsc', hints: {}, reason: 'No runtime cached' };
    const runtime = runtimeInfo.runtime;

    let activeCompiler = { type: 'tsc', command: null };

    if (runtime === 'bun') {
      const homeDir = os.homedir();
      const standardBun = path.join(homeDir, '.bun', 'bin', os.platform() === 'win32' ? 'bun.exe' : 'bun');
      const bunCommand = core.fileExists(standardBun) ? standardBun : (core.hasCommand('bun') ? 'bun' : 'bun');
      activeCompiler = { type: 'bun', command: bunCommand };
    } else if (runtime === 'deno') {
      activeCompiler = { type: 'deno', command: 'deno' };
    } else if (runtime === 'tsc') {
      const localTsc = core.getLocalTscPath(workspacePath);
      activeCompiler = { type: 'tsc', command: core.fileExists(localTsc) ? localTsc : (core.hasCommand('tsc') ? 'tsc' : null) };
    }

    // Shadow dir strategy:
    // - Has real workspace → .vscode/forge-temp/ (persists incremental TSC cache, gitignored)
    // - Loose folder (no .code-workspace) → .vscode/forge-temp (local) if it's a volume, or os.tmpdir() 
    const isLooseFolder = !vscode.workspace.workspaceFile;
    const isExternalVolume = workspacePath.startsWith('/Volumes/');
    
    const shadowDir = (!isLooseFolder || isExternalVolume)
      ? path.join(workspacePath, '.vscode', 'forge-temp')
      : path.join(os.tmpdir(), `forge-typelayer-${Buffer.from(workspacePath).toString('base64').slice(0, 12)}`);

    if (isLooseFolder) {
      this.tempDirs.add(shadowDir); // Track for cleanup on deactivate
    }

    let addWatermark = true;
    try {
      const config = vscode.workspace.getConfiguration('forgeTypeLayer', vscode.Uri.file(workspacePath));
      addWatermark = config.get('addWatermark', true);
    } catch {
      // Ignore
    }

    const healthInfo = this.healthStatus.get(workspacePath) || { binary: { ok: true }, filesystem: { ok: true } };

    return {
      projectRoot: workspacePath,
      shadowDir,  // Expose so orchestrator uses this instead of recomputing
      isLooseFolder,
      isHealthy: healthInfo.binary.ok && healthInfo.filesystem.ok,
      healthInfo,
      lockSuffixes: this._resolveLockSuffixes(workspacePath),
      addWatermark,
      activeCompiler,
      STRATEGY: this.STRATEGY,
      buildStrategy: this.getBuildStrategy(workspacePath),
      setBuildStrategy: (strategy) => this.setBuildStrategy(workspacePath, strategy),
      getTscCommand: () => {
        // Priority: bun tsc > npx tsc > local node_modules tsc > global tsc > deno fallback
        // We use string commands because builder.js uses cp.exec (shell) which handles PATH resolution
        if (core.hasCommand('bun')) return 'bun tsc';
        const localTsc = core.getLocalTscPath(workspacePath);
        if (core.fileExists(localTsc)) return localTsc;
        if (core.hasCommand('npx')) return 'npx tsc';
        if (core.hasCommand('tsc')) return 'tsc';
        if (core.hasCommand('deno')) return 'deno run -A npm:typescript/bin/tsc';
        return null;
      }
    };
  }

  /**
   * Reads the lockSuffixes from VS Code config for a given workspace.
   * Falls back to the canonical defaults if config is absent.
   */
  _resolveLockSuffixes(workspacePath) {
    const DEFAULTS = ['.f.ts', '.forge.ts', '.source.ts', '.f.mts', '.forge.mts', '.source.mts'];
    const VALID_PATTERN = /^\.\w[\w.]*\.m?ts$/;
    
    let raw;
    try {
      const config = vscode.workspace.getConfiguration('forgeTypeLayer', vscode.Uri.file(workspacePath));
      raw = config.get('lockSuffixes', DEFAULTS);
    } catch {
      return DEFAULTS;
    }

    if (!Array.isArray(raw) || raw.length === 0) return DEFAULTS;

    const { logger } = require('./utils/logger');
    const seen = new Set();
    const valid = [];

    for (const entry of raw) {
      if (typeof entry !== 'string' || entry.trim() === '') {
        logger.warn(t('config.warn.nonStringSuffix', JSON.stringify(entry)));
        continue;
      }
      if (!VALID_PATTERN.test(entry)) {
        logger.warn(t('config.warn.invalidSuffix', entry));
        continue;
      }
      if (seen.has(entry)) {
        logger.warn(t('config.warn.duplicateSuffix', entry));
        continue;
      }
      seen.add(entry);
      valid.push(entry);
    }

    if (valid.length === 0) {
      logger.warn(t('config.warn.allInvalidSuffixes'));
      return DEFAULTS;
    }

    return valid;
  }

  /**
   * Cleans up all temp shadow directories created for loose-folder sessions.
   * Call this from extension deactivate().
   */
  cleanupTempDirs() {
    const fs = require('fs');
    for (const dir of this.tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* best-effort */ }
    }
    this.tempDirs.clear();
  }

  /**
   * Retrieves the persisted build strategy for a workspace.
   */
  getBuildStrategy(workspacePath) {
    if (!this.vscContext) return this.STRATEGY.STANDALONE;
    const key = `forge.strategy.${workspacePath}`;
    return this.vscContext.workspaceState.get(key, this.STRATEGY.STANDALONE);
  }

  /**
   * Persists the build strategy for a workspace.
   */
  async setBuildStrategy(workspacePath, strategy) {
    if (!this.vscContext) return;
    const key = `forge.strategy.${workspacePath}`;
    await this.vscContext.workspaceState.update(key, strategy);
  }
}

// Export as a singleton
module.exports = new ForgeContext();
