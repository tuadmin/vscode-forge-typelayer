const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const core = require('./core');

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
    await runQueuedEmit(owner, context, true);
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
const runningTasks = new Map();
const pendingTasks = new Map();

async function getProjectContext(workspaceFolderPath) {
  if (projectContextCache.has(workspaceFolderPath)) {
    return projectContextCache.get(workspaceFolderPath);
  }
  const context = core.extractAliases(workspaceFolderPath);
  projectContextCache.set(workspaceFolderPath, context);
  return context;
}

/**
 * Ensures only one emission task runs at a time per file.
 */
async function runQueuedEmit(owner, context, notify) {
  const entryAbs = owner.entryAbs;
  if (runningTasks.get(entryAbs)) {
    pendingTasks.set(entryAbs, { owner, context, notify });
    return;
  }

  runningTasks.set(entryAbs, true);
  try {
    await emitEntry(owner, context, notify);
  } catch (err) {
    Logger.error('Queue Task Error', err);
  } finally {
    runningTasks.set(entryAbs, false);
    const pending = pendingTasks.get(entryAbs);
    if (pending) {
      pendingTasks.delete(entryAbs);
      // Brief delay to allow FS events to settle before next run
      setTimeout(() => runQueuedEmit(pending.owner, pending.context, pending.notify), 50);
    }
  }
}

async function emitEntry(owner, context, notify) {
  if (getMode(context) === 'off') return;
  const fakeDocument = { uri: vscode.Uri.file(owner.entryAbs), fileName: owner.entryAbs, isClosed: false };
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

  const lockSuffixes = config.get('lockSuffixes', ['.f.ts']);
  const paths = core.predictEmitPaths(owner.entryAbs, owner.outBaseRel, owner.workspaceFolder.uri.fsPath, lockSuffixes);
  
  // Shadow Build Isolation: Use a hidden temp folder for emission
  const shadowBase = path.join(owner.workspaceFolder.uri.fsPath, '.vscode', 'forge-typelayer', 'shadow');
  const entryHash = Buffer.from(owner.entryAbs).toString('hex').slice(-12);
  const shadowDir = path.join(shadowBase, entryHash);
  
  const projectContext = await getProjectContext(owner.workspaceFolder.uri.fsPath);
  let command = core.buildRuntimeCommand(runtime.runtime, {
    workspacePath: owner.workspaceFolder.uri.fsPath,
    entryAbs: owner.entryAbs,
    outBaseAbs: path.resolve(owner.workspaceFolder.uri.fsPath, owner.outBaseRel),
    config: { 
      target: config.get('target', 'ES2022'), 
      removeComments: config.get('removeComments', false),
      outDir: shadowDir, // REDIRECT to shadow
      rootDir: owner.workspaceFolder.uri.fsPath,
      entryFile: owner.entryAbs
    }
  });

  // If using Bun/TSC and aliases are present, switch to Synthetic Config via -p
  if (Object.keys(projectContext.paths).length > 0 && (runtime.runtime === 'tsc' || runtime.runtime === 'bun')) {
    const syntheticConfig = core.buildSyntheticConfig(owner.workspaceFolder.uri.fsPath, projectContext, {
      target: config.get('target', 'ES2022'),
      removeComments: config.get('removeComments', false),
      outDir: shadowDir,
      rootDir: owner.workspaceFolder.uri.fsPath,
      entryFile: owner.entryAbs
    });
    const configPath = core.buildSyntheticConfigPath(owner.workspaceFolder.uri.fsPath);
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(configPath)));
      const configStr = JSON.stringify(syntheticConfig, null, 2);
      await vscode.workspace.fs.writeFile(vscode.Uri.file(configPath), Buffer.from(configStr, 'utf8'));
      
      const tscArgs = ['-p', configPath];
      if (runtime.runtime === 'tsc') {
        const tscPath = core.getLocalTscPath(owner.workspaceFolder.uri.fsPath);
        command = { command: fs.existsSync(tscPath) ? tscPath : 'tsc', args: tscArgs, mode: 'external' };
      } else {
        command = { command: 'bunx', args: ['tsc', ...tscArgs], mode: 'external' };
      }
    } catch (e) {
      Logger.error('Synthetic Config Error', e);
    }
  }

  // Ensure shadow directory and specific sub-emit directory exist and are clean
  try {
    const sourceDir = path.dirname(owner.entryAbs);
    const relDir = path.relative(owner.workspaceFolder.uri.fsPath, sourceDir);
    const shadowEmitDir = path.join(shadowDir, relDir);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(shadowEmitDir));
  } catch {}

  const addWatermark = config.get('addWatermark', true);

  if (command.mode !== 'api' && command.command) {
    Logger.log(`Executing external compiler (${runtime.runtime}): ${command.command} ${command.args.join(' ')}`);
    const result = core.runExternalCommand(command.command, command.args, owner.workspaceFolder.uri.fsPath);
    
    if (result.stdout) outputChannel.appendLine(`[TSC STDOUT] ${result.stdout}`);
    if (result.stderr) outputChannel.appendLine(`[TSC STDERR] ${result.stderr}`);

    const executedSuccessfully = result.ok || (result.status && result.status > 0);

    if (executedSuccessfully) {
      // Surgical Extraction: Move from shadow to real outDir
      try {
        const sourceDir = path.dirname(owner.entryAbs);
        const relDir = path.relative(owner.workspaceFolder.uri.fsPath, sourceDir);
        const shadowEmitDir = path.join(shadowDir, relDir);
        
        // Optional Polyglot Bundling (only for JS)
        const bundlerCmd = core.getBundlerCommand(runtime.runtime, owner.entryAbs, path.join(shadowEmitDir, path.basename(paths.jsPath)), projectContext);
        let wasBundled = false;
        if (bundlerCmd) {
          const bundleResult = core.runExternalCommand(bundlerCmd.command, bundlerCmd.args, owner.workspaceFolder.uri.fsPath);
          if (bundleResult.ok) {
            wasBundled = true;
            Logger.debug('Bundler', `Inlined private helpers via ${runtime.runtime} build.`);
          }
        }

        let shadowEmitDir = path.join(shadowDir, relDir);
        
        let shadowFiles = [];
        try {
          shadowFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(shadowEmitDir));
        } catch (e) {
          // Fallback: If subfolder doesn't exist, try reading from shadow base (flattened output)
          Logger.debug('Extraction', `Subfolder ${relDir} not found in shadow, trying base shadowDir.`);
          shadowEmitDir = shadowDir;
          shadowFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(shadowEmitDir));
        }

        await vscode.workspace.fs.createDirectory(vscode.Uri.file(paths.outDir));

        for (const [name, type] of shadowFiles) {
          if (type !== vscode.FileType.File) continue;
          
          const isMain = name.startsWith(path.basename(owner.entryAbs).replace(/\.(ts|mts)$/, ''));
          const isInternal = name.startsWith('_');
          
          if (isMain || isInternal) {
            // IF bundled, skip moving the separate private .js files (keep only .d.ts)
            if (wasBundled && isInternal && name.endsWith('.js')) continue;

            // Important: Use the effectively detected shadowEmitDir (either the sub-path or the base)
            const shadowFileAbs = path.join(shadowEmitDir, name);
            let finalName = name;
            
            const matchedSuffix = lockSuffixes.find(s => name.includes(s.replace('.ts', '')));
            if (matchedSuffix) {
              finalName = name.replace(matchedSuffix.replace('.ts', ''), '');
            }

            const finalTargetAbs = path.join(paths.outDir, finalName);
            await delay(50);
            await vscode.workspace.fs.copy(vscode.Uri.file(shadowFileAbs), vscode.Uri.file(finalTargetAbs), { overwrite: true });

            if (addWatermark && finalName.match(/\.(js|mjs|d\.ts|d\.mts)$/)) {
              const jsRelSource = path.relative(path.dirname(finalTargetAbs), owner.entryAbs).replace(/\\/g, '/');
              const safePath = (jsRelSource.startsWith('.') || jsRelSource.startsWith('/')) ? jsRelSource : `./${jsRelSource}`;
              const contentBuf = await vscode.workspace.fs.readFile(vscode.Uri.file(finalTargetAbs));
              const watermarked = core.prependWatermark(Buffer.from(contentBuf).toString('utf8'), safePath);
              await vscode.workspace.fs.writeFile(vscode.Uri.file(finalTargetAbs), Buffer.from(watermarked, 'utf8'));
            }
          }
        }
        
        await vscode.workspace.fs.delete(vscode.Uri.file(shadowDir), { recursive: true, useTrash: false });
      } catch (err) {
        Logger.error('Surgical Extraction Error', err);
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
