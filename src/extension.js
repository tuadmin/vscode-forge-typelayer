const vscode = require('vscode');
const path = require('path');
const core = require('./core');
const forgeContext = require('./context');
const batchOrchestrator = require('./engine/batchOrchestrator');
const { logger } = require('./utils/logger');
const { t } = require('./utils/i18n');

const MODE_KEY = 'forgeTypeLayer.mode';

function activate(context) {
  // Logger is globally initialized, just notify activation
  logger.info(t('info.activated'));
  forgeContext.setExtensionContext(context);
  
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = 'forgeTypeLayer.selectMode';
  context.subscriptions.push(statusBar);
  
  if (vscode.workspace.workspaceFolders?.[0]) {
    forgeContext.initializeWorkspace(vscode.workspace.workspaceFolders[0].uri.fsPath, vscode.workspace.getConfiguration('forgeTypeLayer'));
  }

  const updateUI = () => updateStatusBar(context, statusBar);

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateUI));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('forgeTypeLayer')) {
      if (vscode.workspace.workspaceFolders?.[0]) {
        forgeContext.initializeWorkspace(vscode.workspace.workspaceFolders[0].uri.fsPath, vscode.workspace.getConfiguration('forgeTypeLayer'));
      }
      updateUI();
    }
  }));

  // ======================================
  // CORE ENGINE PIPELINE: The Gateway
  // ======================================
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (getMode(context) !== 'auto') return;
    
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) return;
    
    const config = vscode.workspace.getConfiguration('forgeTypeLayer', document);
    const lockSuffixes = config.get('lockSuffixes', ['.source.ts', '.f.ts']);
    
    // Reverse-lookup to find the REAL entry point instead of compiling a helper directly
    const owner = core.resolveOwningEntryByFile(
      workspaceFolder.uri.fsPath, 
      config.get('entriesFile', 'forge-typelayer.entries.json'), 
      document.fileName,
      lockSuffixes
    );

    if (!owner) return;

    // We pass a synthetic document object pointing to the true entry point
    const fakeDoc = { fileName: owner.entryAbs };
    
    // Resolve the flat engine context from the singleton for this workspace
    const engineCtx = forgeContext.resolveEngineContext(workspaceFolder.uri.fsPath);
    
    // Delegate entirely to the unified batch orchestrator.
    batchOrchestrator.scheduleEmission(fakeDoc, engineCtx);
    updateUI();
  }));

  // ======================================
  // COMMANDS
  // ======================================
  context.subscriptions.push(vscode.commands.registerCommand('forgeTypeLayer.toggleMode', async () => {
    const current = getMode(context);
    const next = current === 'off' ? 'manual' : current === 'manual' ? 'auto' : 'off';
    await context.workspaceState.update(MODE_KEY, next);
    updateStatusBar(context, statusBar);
    vscode.window.showInformationMessage(t('msg.modeChanged', next.toUpperCase()));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('forgeTypeLayer.selectMode', async () => {
    const picked = await vscode.window.showQuickPick([
      { label: t('mode.off'), description: 'No automatic actions', value: 'off' },
      { label: t('mode.manual'), description: 'Commands only', value: 'manual' },
      { label: t('mode.auto'), description: 'Emit on save for declared entries', value: 'auto' }
    ], { placeHolder: 'Select Forge TypeLayer mode' });
    if (!picked) return;
    await context.workspaceState.update(MODE_KEY, picked.value);
    updateStatusBar(context, statusBar);
    vscode.window.showInformationMessage(t('msg.modeChanged', picked.label));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('forgeTypeLayer.emitCurrentFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return vscode.window.showWarningMessage(t('msg.noActiveEditor'));
    
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!folder) return vscode.window.showWarningMessage(t('msg.noWorkspaceFolder'));
    
    const engineCtx = forgeContext.resolveEngineContext(folder.uri.fsPath);
    batchOrchestrator.scheduleEmission(editor.document, engineCtx);
    updateUI();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('forgeTypeLayer.showRuntimeInfo', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return vscode.window.showWarningMessage(t('msg.noWorkspaceFolder'));
    const config = vscode.workspace.getConfiguration('forgeTypeLayer');
    const result = core.resolveRuntimePreference({ workspacePath: folder.uri.fsPath, preferredRuntime: config.get('preferredRuntime', 'auto') });
    vscode.window.showInformationMessage(t('msg.runtimeInfo', result.runtime, result.reason));
  }));
}

function deactivate() {
    // Clean up any temp shadow dirs created for loose-folder (no .code-workspace) sessions
    forgeContext.cleanupTempDirs();
}

function getMode(context) {
  return context.workspaceState.get(MODE_KEY, 'off');
}

function updateStatusBar(context, statusBar) {
  const mode = getMode(context);
  if (mode === 'off') {
    statusBar.hide();
    return;
  }

  const editor = vscode.window.activeTextEditor;
  const config = vscode.workspace.getConfiguration('forgeTypeLayer', editor?.document);
  const lockSuffixes = config.get('lockSuffixes', ['.source.ts', '.f.ts']);
  
  let detectedSuffix = null;
  if (editor) {
    const fileName = editor.document.fileName;
    detectedSuffix = lockSuffixes.find(s => fileName.endsWith(s));
  }

  const indicator = detectedSuffix ? `<${detectedSuffix.startsWith('.') ? detectedSuffix.slice(1) : detectedSuffix}>` : 'TypeLayer';
  
  statusBar.text = `Forge ${indicator} [${mode.toUpperCase()}]`;
  statusBar.tooltip = detectedSuffix ? t('status.bar.ready') : t('status.bar.watching');
  statusBar.show();
}

module.exports = { activate, deactivate };
