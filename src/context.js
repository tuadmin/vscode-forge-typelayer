const vscode = require('vscode');
const core = require('./core');

class ForgeContext {
  constructor() {
    this.runtimes = new Map(); // workspaceFSPath -> { runtime, hints, reason }
    this.aliases = new Map();   // workspaceFSPath -> alias object
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

    // 2. Resolve aliases once
    const aliases = core.extractAliases(workspacePath);
    this.aliases.set(workspacePath, aliases);

    return { runtime, aliases };
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
}

// Export as a singleton
module.exports = new ForgeContext();
