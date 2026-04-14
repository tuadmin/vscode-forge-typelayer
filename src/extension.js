const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const core = require('./core');
const forgeContext = require('./context');
const batchEmitEngine = require('./batchEmit');

const pkg = require('../package.json');
const isPreRelease = String(pkg.version || '').includes('-');
let outputChannel;

const Logger = {
  info: (msg) => { if (outputChannel) outputChannel.appendLine(`[INFO] ${msg}`); },
  warn: (msg) => { if (outputChannel) outputChannel.appendLine(`[WARN] ${msg}`); },
  error: (tag, err) => { if (outputChannel) outputChannel.appendLine(`[ERROR] ${tag}: ${err}`); console.error(`[Forge] ${tag}:`, err); },
  debug: (tag, ...args) => { 
    if (isPreRelease) {
      if (outputChannel) outputChannel.appendLine(`[DEBUG] ${tag}: ${args.join(' ')}`);
      console.log(`[Forge DBG] ${tag}:`, ...args); 
    }
  },
  log: (msg) => Logger.info(msg)
};

const delay = ms => new Promise(res => setTimeout(res, ms));

const MODE_KEY = 'forgeTypeLayer.mode';

const FALLBACK_BUNDLE = {
  "mode.off": "OFF",
  "mode.manual": "MANUAL",
  "mode.auto": "AUTO",
  "status.bar.tooltip": "Forge TypeLayer mode",
  "status.bar.ready": "Forge is ready to emit from this source.",
  "status.bar.watching": "Forge is watching for saves.",
  "msg.noActiveEditor": "No active editor.",
  "msg.noWorkspaceFolder": "No workspace folder open.",
  "msg.notDeclaredEntry": "Current file is not part of a declared entry.",
  "msg.openPublicJs": "Open a public .js file first.",
  "msg.modeChanged": "Forge TypeLayer mode: {0}",
  "msg.runtimeInfo": "Runtime: {0} — {1}",
  "msg.reconstructed": "Reconstructed draft created: {0}",
  "msg.preflight": "Forge TypeLayer preflight: {0}",
  "msg.lintBlocked": "Forge TypeLayer blocked emit: lint failed for {0}. {1}",
  "msg.validationBlocked": "Forge TypeLayer blocked emit: validation failed for {0}. {1}",
  "msg.tsBlocked": "Forge TypeLayer blocked emit: TypeScript diagnostics failed. {0}",
  "msg.externalFallback": "External emit via {0} did not complete public output. Falling back to TypeScript API.",
  "msg.emittedExternal": "Emitted with {0}: {1} and {2}",
  "msg.emittedFallback": "Emitted with TypeScript API fallback: {0} and {1}"
};

function t(key, ...args) {
  let message = vscode.l10n.t(key, ...args);
  if (message === key && FALLBACK_BUNDLE[key]) {
    message = FALLBACK_BUNDLE[key];
    // Simple placeholder replacement for fallback
    args.forEach((arg, i) => {
      message = message.replace(`{${i}}`, arg);
    });
  }
  return message;
}

function activate(context) {
  outputChannel = vscode.window.createOutputChannel("Forge TypeLayer");
  context.subscriptions.push(outputChannel);
  
  Logger.log("Forge TypeLayer activated. Ready to forge.");

  // Watch for project config changes to clear alias cache
  const configWatcher = vscode.workspace.createFileSystemWatcher('**/{tsconfig,jsconfig,deno,import_map}.json');
  configWatcher.onDidChange(() => projectContextCache.clear());
  configWatcher.onDidCreate(() => projectContextCache.clear());
  configWatcher.onDidDelete(() => projectContextCache.clear());
  context.subscriptions.push(configWatcher);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = 'forgeTypeLayer.selectMode';
  context.subscriptions.push(statusBar);
  
  if (vscode.workspace.workspaceFolders?.[0]) {
    forgeContext.initializeWorkspace(vscode.workspace.workspaceFolders[0].uri.fsPath, vscode.workspace.getConfiguration('forgeTypeLayer'));
  }

  const updateUI = () => updateStatusBar(context, statusBar);

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateUI));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('forgeTypeLayer')) updateUI();
  }));

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (getMode(context) !== 'auto') return;
    const owner = await resolveOwningEntry(document);
    if (!owner) return;
    await emitEntry(owner, context, false);
    updateUI();
  }));

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
    const owner = await resolveOwningEntry(editor.document);
    if (!owner) return vscode.window.showWarningMessage(t('msg.notDeclaredEntry'));
    batchEmitEngine.scheduleEmit(owner, context, true, Logger, outputChannel, getMode);
    updateStatusBar(context, statusBar);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('forgeTypeLayer.reconstructFromPublicArtifacts', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return vscode.window.showWarningMessage(t('msg.noActiveEditor'));
    const fileName = editor.document.fileName;
    if (!fileName.endsWith('.js')) return vscode.window.showWarningMessage(t('msg.openPublicJs'));
    const dts = fileName.replace(/\.js$/, '.d.ts');
    const suffix = vscode.workspace.getConfiguration('forgeTypeLayer', editor.document).get('reconstructSuffix', '.reconstructed.mts');
    const output = fileName.replace(/\.js$/, suffix);
    const jsText = editor.document.getText();
    const dtsText = fs.existsSync(dts) ? fs.readFileSync(dts, 'utf8') : '';
    fs.writeFileSync(output, core.buildReconstructedSource(jsText, dtsText, path.basename(fileName)), 'utf8');
    await vscode.window.showTextDocument(vscode.Uri.file(output));
    vscode.window.showInformationMessage(t('msg.reconstructed', path.basename(output)));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('forgeTypeLayer.showSpec', async () => {
    const specPath = path.join(context.extensionPath, 'docs', 'internal-spec.md');
    await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(specPath));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('forgeTypeLayer.showRuntimeInfo', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return vscode.window.showWarningMessage(t('msg.noWorkspaceFolder'));
    const config = vscode.workspace.getConfiguration('forgeTypeLayer');
    const result = core.resolveRuntimePreference({ workspacePath: folder.uri.fsPath, preferredRuntime: config.get('preferredRuntime', 'auto') });
    vscode.window.showInformationMessage(t('msg.runtimeInfo', result.runtime, result.reason));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('forgeTypeLayer.doctorWorkspace', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return vscode.window.showWarningMessage(t('msg.noWorkspaceFolder'));
    const config = vscode.workspace.getConfiguration('forgeTypeLayer');
    const report = core.buildDoctorReport(folder.uri.fsPath, config.get('preferredRuntime', 'auto'), config.get('entriesFile', 'forge-typelayer.entries.json'));
    const hints = JSON.stringify(report.hints, null, 2);
    const warnings = report.preflight.warnings.length ? `${t('doctor.warningPrefix')}\n- ${report.preflight.warnings.join('\n- ')}` : t('doctor.ok');
    const content = `# ${t('doctor.title')}\n\n- ${t('doctor.runtime', report.runtime.runtime)}\n- ${t('doctor.lint', report.lint.kind)}\n- ${t('doctor.manifest', report.manifestPath)}\n\n## ${t('doctor.hints', '')}\n\n\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\
\n\`\`\`json\n${hints}\n\`\`\`\n\n## Summary\n\n${warnings}\n`;
    const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
  }));
}

function deactivate() { }

async function ensureInitialMode(context) {
  const current = context.workspaceState.get(MODE_KEY);
  if (current) return;
  const config = vscode.workspace.getConfiguration('forgeTypeLayer');
  await context.workspaceState.update(MODE_KEY, config.get('defaultMode', 'off'));
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
  const lockSuffixes = config.get('lockSuffixes', ['.f.ts', '.forge.ts', '.source.ts', '.f.mts', '.forge.mts', '.source.mts']);
  
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

async function resolveOwningEntry(document) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) return null;
  const config = vscode.workspace.getConfiguration('forgeTypeLayer', document);
  const lockSuffixes = config.get('lockSuffixes', ['.f.ts']);
  const owner = core.resolveOwningEntryByFile(
    workspaceFolder.uri.fsPath, 
    config.get('entriesFile', 'forge-typelayer.entries.json'), 
    document.fileName,
    lockSuffixes
  );
  if (!owner) return null;
  return { workspaceFolder, ...owner };
}

function tryRequire(modulePath) {
  try { return require(modulePath); } catch { return null; }
}

function resolveTypescript(workspaceFolder, document) {
  const config = vscode.workspace.getConfiguration('forgeTypeLayer', document);

  // 1. Prioritize Workspace TypeScript (if enabled)
  if (config.get('useWorkspaceTypescript', true) && workspaceFolder) {
    const localTs = path.join(workspaceFolder.uri.fsPath, 'node_modules', 'typescript');
    const ts = tryRequire(localTs);
    if (ts) return ts;
  }

  // 2. Global/Environment TypeScript
  try {
    return require('typescript');
  } catch {
    // 3. Last Resort: Load from extension's own node_modules (built-in)
    // context.extensionPath is not easily available here, so we crawl up from __dirname
    const builtInTs = path.join(__dirname, '..', 'node_modules', 'typescript');
    const ts = tryRequire(builtInTs);
    if (ts) return ts;
    throw new Error('Could not find TypeScript. Please ensure it is installed in your workspace or extension directory.');
  }
}

const projectContextCache = new Map();

async function getProjectContext(workspaceFolderPath) {
  if (projectContextCache.has(workspaceFolderPath)) {
    return projectContextCache.get(workspaceFolderPath);
  }
  const context = core.extractAliases(workspaceFolderPath);
  projectContextCache.set(workspaceFolderPath, context);
  return context;
}

// Emitting is now handled by batchEmit.js

function buildCompilerOptions(ts, config, entryAbs) {
  const targetMap = { ES2018: ts.ScriptTarget.ES2018, ES2020: ts.ScriptTarget.ES2020, ES2022: ts.ScriptTarget.ES2022, ESNext: ts.ScriptTarget.ESNext };
  return {
    target: targetMap[config.get('target', 'ES2022')] || ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    declaration: true,
    emitDeclarationOnly: false,
    noEmitOnError: true,
    removeComments: !!config.get('removeComments', false),
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    rewriteRelativeImportExtensions: true,
    esModuleInterop: true,
    allowJs: true,
    checkJs: false,
    skipLibCheck: true,
    strict: false
  };
}



module.exports = { activate, deactivate };
