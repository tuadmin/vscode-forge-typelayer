const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const core = require('./core');

const pkg = require('../package.json');
const isPreRelease = String(pkg.version || '').includes('-');
const Logger = {
  debug: (...args) => { if (isPreRelease) console.log('[Forge TL Debug]', ...args); }
};

const MODE_KEY = 'forgeTypeLayer.mode';

function t(key, ...args) {
  return vscode.l10n.t(key, ...args);
}

function activate(context) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = 'forgeTypeLayer.selectMode';
  context.subscriptions.push(statusBar);
  ensureInitialMode(context)
    .then(() => updateStatusBar(context, statusBar))
    .catch(err => Logger.debug('Critical: Failed to hydrate initial mode:', err));

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (getMode(context) !== 'auto') return;
    const owner = await resolveOwningEntry(document);
    if (!owner) return;
    await emitEntry(owner, context, false);
    updateStatusBar(context, statusBar);
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
    await emitEntry(owner, context, true);
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
  const icon = mode === 'auto' ? '$(sync)' : mode === 'manual' ? '$(tools)' : '$(circle-slash)';
  statusBar.text = `${icon} Forge TypeLayer: ${mode.toUpperCase()}`;
  statusBar.tooltip = t('status.bar.tooltip');
  statusBar.show();
}

async function resolveOwningEntry(document) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) return null;
  const config = vscode.workspace.getConfiguration('forgeTypeLayer', document);
  const owner = core.resolveOwningEntryByFile(workspaceFolder.uri.fsPath, config.get('entriesFile', 'forge-typelayer.entries.json'), document.fileName);
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

async function emitEntry(owner, context, notify) {
  const fakeDocument = { uri: vscode.Uri.file(owner.entryAbs), fileName: owner.entryAbs };
  const config = vscode.workspace.getConfiguration('forgeTypeLayer', fakeDocument);
  const runtime = core.resolveRuntimePreference({ workspacePath: owner.workspaceFolder.uri.fsPath, preferredRuntime: config.get('preferredRuntime', 'auto') });
  const preflight = core.preflightWorkspaceChecks(owner.workspaceFolder.uri.fsPath, runtime.runtime, config.get('entriesFile', 'forge-typelayer.entries.json'));

  if (preflight.warnings.length && (config.get('showNotifications', true) || notify)) {
    vscode.window.showWarningMessage(t('msg.preflight', preflight.warnings.join(' | ')));
  }

  if (config.get('preLint', true)) {
    const lintStrategy = core.detectLintStrategy(owner.workspaceFolder.uri.fsPath, runtime.runtime);
    const lintCommand = core.buildLintCommand(lintStrategy, owner.entryAbs);
    if (lintCommand.command) {
      const lintResult = core.runExternalCommand(lintCommand.command, lintCommand.args, owner.workspaceFolder.uri.fsPath);
      if (!lintResult.ok) {
        const rawErr = lintResult.stdout || lintResult.stderr || lintStrategy.reason;
        const shortErr = rawErr.split('\n').filter(l => l.trim()).slice(0, 2).join(' | ');
        vscode.window.showErrorMessage(t('msg.lintBlocked', path.basename(owner.entryAbs), `${shortErr} [...] 👉 Run to debug: ${lintCommand.command} ${lintCommand.args.join(' ')}`));
        return;
      }
    } else {
      const minimal = core.runMinimalValidation(owner.entryAbs);
      if (!minimal.ok) {
        vscode.window.showErrorMessage(t('msg.validationBlocked', path.basename(owner.entryAbs), minimal.reason));
        return;
      }
    }
  }

  const paths = core.predictEmitPaths(owner.entryAbs, owner.outBaseRel, owner.workspaceFolder.uri.fsPath);
  fs.mkdirSync(paths.outDir, { recursive: true });

  const command = core.buildRuntimeCommand(runtime.runtime, {
    workspacePath: owner.workspaceFolder.uri.fsPath,
    entryAbs: owner.entryAbs,
    outBaseAbs: path.resolve(owner.workspaceFolder.uri.fsPath, owner.outBaseRel),
    config: { target: config.get('target', 'ES2022'), removeComments: config.get('removeComments', false) }
  });

  const addWatermark = config.get('addWatermark', true);

  if (command.mode !== 'api' && command.command) {
    Logger.debug('Executing external compiler:', `${command.command} ${command.args.join(' ')}`);
    const result = core.runExternalCommand(command.command, command.args, owner.workspaceFolder.uri.fsPath);
    Logger.debug('External command result:', result.ok, 'Status:', result.status, 'Error:', result.stderr);

    // Si TS corrió pero falló con errores de tipado, status es 1 o 2. Si falló por no encontrar el binario, code es ENOENT.
    const executedSuccessfully = result.ok || result.status > 0;

    if (executedSuccessfully) {
      if (owner.entryAbs.match(/\.f\.(ts|mts)$/i)) {
        const rawPaths = core.predictEmitPaths(owner.entryAbs, owner.outBaseRel, owner.workspaceFolder.uri.fsPath, true);
        Logger.debug('Target locked output is:', paths.jsPath, 'Exists raw JS?', fs.existsSync(rawPaths.jsPath));
        if (fs.existsSync(rawPaths.jsPath)) fs.renameSync(rawPaths.jsPath, paths.jsPath);
        if (fs.existsSync(rawPaths.dtsPath)) fs.renameSync(rawPaths.dtsPath, paths.dtsPath);
      }

      if (addWatermark) {
        const jsRelSource = path.relative(path.dirname(paths.jsPath), owner.entryAbs).replace(/\\/g, '/');
        const dtsRelSource = path.relative(path.dirname(paths.dtsPath), owner.entryAbs).replace(/\\/g, '/');
        if (fs.existsSync(paths.jsPath)) fs.writeFileSync(paths.jsPath, core.prependWatermark(fs.readFileSync(paths.jsPath, 'utf8'), jsRelSource), 'utf8');
        if (fs.existsSync(paths.dtsPath)) fs.writeFileSync(paths.dtsPath, core.prependWatermark(fs.readFileSync(paths.dtsPath, 'utf8'), dtsRelSource), 'utf8');
      }

      let warnMissing = '';
      if (!fs.existsSync(paths.dtsPath)) warnMissing = ' (Declarations skipped)';
      if (!result.ok && result.stdout) warnMissing += ' | Warning: TS Errors detected';

      if (config.get('showNotifications', true) || notify) vscode.window.showInformationMessage(t('msg.emittedExternal', runtime.runtime, path.basename(paths.jsPath), path.basename(paths.dtsPath)) + warnMissing);
      return;
    }

    if (config.get('showNotifications', true) || notify) vscode.window.showWarningMessage(t('msg.externalFallback', runtime.runtime));
  } else if (command.mode === 'api') {
    Logger.debug('Command mode is explicitly set to API');
  }

  Logger.debug('Entering internal TS API fallback');
  const ts = resolveTypescript(owner.workspaceFolder, fakeDocument);
  const sourceText = fs.readFileSync(owner.entryAbs, 'utf8');
  const compilerOptions = buildCompilerOptions(ts, config, owner.entryAbs);
  const host = ts.createCompilerHost(compilerOptions);
  const outputs = new Map();
  const originalReadFile = host.readFile.bind(host);
  host.readFile = (filePath) => path.resolve(filePath) === path.resolve(owner.entryAbs) ? sourceText : originalReadFile(filePath);
  host.writeFile = (name, text) => outputs.set(path.resolve(name), text);

  const program = ts.createProgram([owner.entryAbs], compilerOptions, host);
  const emitResult = program.emit();
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics || []);
  const errors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    const msg = ts.flattenDiagnosticMessageText(errors[0].messageText, '\n');
    vscode.window.showErrorMessage(t('msg.tsBlocked', msg));
    return;
  }

  const assets = core.extractEmittedAssets(outputs);
  if (addWatermark) {
    if (assets.jsContent) {
      const jsRelSource = path.relative(path.dirname(paths.jsPath), owner.entryAbs).replace(/\\/g, '/');
      assets.jsContent = core.prependWatermark(assets.jsContent, jsRelSource);
    }
    if (assets.dtsContent) {
      const dtsRelSource = path.relative(path.dirname(paths.dtsPath), owner.entryAbs).replace(/\\/g, '/');
      assets.dtsContent = core.prependWatermark(assets.dtsContent, dtsRelSource);
    }
  }
  if (assets.jsContent) fs.writeFileSync(paths.jsPath, assets.jsContent, 'utf8');
  if (assets.dtsContent) fs.writeFileSync(paths.dtsPath, assets.dtsContent, 'utf8');

  let warnMissingInfo = '';
  if (!assets.dtsContent) warnMissingInfo = ' (Declarations skipped)';

  if (config.get('showNotifications', true) || notify) vscode.window.showInformationMessage(t('msg.emittedFallback', path.basename(paths.jsPath), path.basename(paths.dtsPath)) + warnMissingInfo);
}

function buildCompilerOptions(ts, config, entryAbs) {
  const targetMap = { ES2018: ts.ScriptTarget.ES2018, ES2020: ts.ScriptTarget.ES2020, ES2022: ts.ScriptTarget.ES2022, ESNext: ts.ScriptTarget.ESNext };
  const isMts = entryAbs.endsWith('.mts');
  return {
    target: targetMap[config.get('target', 'ES2022')] || ts.ScriptTarget.ES2022,
    module: isMts ? ts.ModuleKind.ES2022 : ts.ModuleKind.CommonJS,
    declaration: true,
    emitDeclarationOnly: false,
    noEmitOnError: true,
    removeComments: !!config.get('removeComments', false),
    moduleResolution: isMts ? ts.ModuleResolutionKind.Bundler : ts.ModuleResolutionKind.NodeJs,
    rewriteRelativeImportExtensions: true,
    esModuleInterop: true,
    allowJs: true,
    checkJs: false,
    skipLibCheck: true,
    strict: false
  };
}



module.exports = { activate, deactivate };
