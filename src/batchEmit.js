const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const core = require('./core');
const forgeContext = require('./context');
const { t } = require('../l10n/l10n');

const pendingBatch = new Map();
let batchTimeout = null;

/**
 * Ensures only one batch emission task runs at a time per workspace.
 */
function scheduleEmit(owner, context, notify, Logger, outputChannel, getMode) {
  if (getMode(context) === 'off') return;
  const workspacePath = owner.workspaceFolder.uri.fsPath;
  
  if (!pendingBatch.has(workspacePath)) {
    pendingBatch.set(workspacePath, new Set());
  }
  
  const batch = pendingBatch.get(workspacePath);
  let existing = Array.from(batch).find(o => o.entryAbs === owner.entryAbs);
  if (!existing) {
    batch.add({ ...owner, notify });
  } else if (notify) {
    existing.notify = true;
  }

  if (batchTimeout) clearTimeout(batchTimeout);
  batchTimeout = setTimeout(async () => {
    batchTimeout = null;
    const workspaces = Array.from(pendingBatch.keys());
    for (const ws of workspaces) {
      const ownersToProcess = Array.from(pendingBatch.get(ws));
      pendingBatch.delete(ws);
      await executeBatchEmit(ownersToProcess, ws, context, Logger, outputChannel);
    }
  }, 300); // 300ms debounce
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function executeBatchEmit(owners, workspacePath, context, Logger, outputChannel) {
  if (owners.length === 0) return;
  const firstOwner = owners[0];
  const fakeDocument = { uri: vscode.Uri.file(firstOwner.entryAbs), fileName: firstOwner.entryAbs, isClosed: false };
  const config = vscode.workspace.getConfiguration('forgeTypeLayer', fakeDocument);
  const notify = owners.some(o => o.notify);
  
  const runtimeState = forgeContext.getRuntime(workspacePath) || core.resolveRuntimePreference({ workspacePath, preferredRuntime: config.get('preferredRuntime', 'auto') });
  const aliases = forgeContext.getAliases(workspacePath);
  const runtime = runtimeState.runtime;

  // Preflight check
  const preflight = core.preflightWorkspaceChecks(workspacePath, runtime, config.get('entriesFile', 'forge-typelayer.entries.json'));
  if (preflight.warnings.length && (config.get('showNotifications', true) || notify)) {
    vscode.window.showWarningMessage(t('msg.preflight', preflight.warnings.join(' | ')));
  }

  // TSC Consent Validation
  if (runtime === 'tsc' && !forgeContext.hasTscConsent(workspacePath)) {
    const selection = await vscode.window.showWarningMessage(
      "⚠️ Bun/Deno not found. Using TSC as fallback. TSC will output separate files for every imported local module (No bundling). Proceed?",
      "Proceed & Don't Ask Again",
      "Cancel"
    );
    if (selection === "Proceed & Don't Ask Again") {
      await forgeContext.grantTscConsent(workspacePath);
    } else {
      return; // Aborted
    }
  }

  const filesAbs = owners.map(o => o.entryAbs);
  const lockSuffixes = config.get('lockSuffixes', ['.f.ts', '.forge.ts', '.source.ts', '.f.mts', '.forge.mts', '.source.mts']);
  const outDir = path.resolve(workspacePath, firstOwner.outBaseRel); // Simplification: assume all in batch share outBaseRel for root mapping

  // 1. Run TSC Types Generation
  let tsCommand = null;
  const usingSyntheticConfig = Object.keys(aliases.paths).length > 0 && (runtime === 'tsc' || runtime === 'bun');
  
  if (usingSyntheticConfig) {
    const syntheticConfig = core.buildSyntheticConfig(workspacePath, aliases, {
      target: config.get('target', 'ES2022'),
      removeComments: config.get('removeComments', false),
      outDir: outDir,
      rootDir: workspacePath,
      entryFiles: filesAbs
    });
    const configPath = core.buildSyntheticConfigPath(workspacePath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(configPath)));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(configPath), Buffer.from(JSON.stringify(syntheticConfig, null, 2), 'utf8'));
    
    const tscArgs = ['-p', configPath, '--emitDeclarationOnly', 'true'];
    if (runtime === 'tsc') {
      const tscPath = core.getLocalTscPath(workspacePath);
      tsCommand = { command: fs.existsSync(tscPath) ? tscPath : 'tsc', args: tscArgs, mode: 'external' };
    } else {
      tsCommand = { command: 'bunx', args: ['tsc', ...tscArgs], mode: 'external' };
    }
  } else {
    tsCommand = core.buildBatchTscCommand(runtime, {
      workspacePath,
      filesAbs,
      config: { 
        outDir, rootDir: workspacePath, target: config.get('target', 'ES2022'), 
        removeComments: config.get('removeComments', false), emitDeclarationOnly: true,
        usingSyntheticConfig: false
      }
    });
  }

  // Execute Types Generation
  if (tsCommand && tsCommand.command) {
    Logger.log(`Generating types (${runtime}): ${tsCommand.command} ${tsCommand.args.join(' ')}`);
    const tsResult = core.runExternalCommand(tsCommand.command, tsCommand.args, workspacePath);
    if (tsResult.stdout) outputChannel.appendLine(`[TSC STDOUT] ${tsResult.stdout}`);
    if (tsResult.stderr) outputChannel.appendLine(`[TSC STDERR] ${tsResult.stderr}`);
  }

  // 2. Perform Bundling if possible, else rely entirely on TSC for JS
  let emitJsWithTsc = true;
  let warnMissing = '';

  if (runtime === 'bun' || runtime === 'deno') {
    const bundlerCmd = core.buildBatchBundlerCommand(runtime, filesAbs, outDir, aliases);
    if (bundlerCmd) {
      Logger.log(`Executing Polyglot Bundler (${runtime}): ${bundlerCmd.command} ${bundlerCmd.args.join(' ')}`);
      const bundleResult = core.runExternalCommand(bundlerCmd.command, bundlerCmd.args, workspacePath);
      if (bundleResult.ok) {
        emitJsWithTsc = false;
        Logger.debug('Bundler', `Successfully built JS payload via ${runtime}.`);
      } else {
        Logger.error('Bundler failed, falling back to TSC JS emission', bundleResult.stderr);
      }
    }
  }

  if (emitJsWithTsc) {
    // Re-run TSC without emitDeclarationOnly to get the JS (TSC fallback)
    const fallbackArgs = tsCommand.args.filter(a => a !== '--emitDeclarationOnly' && a !== 'true' && a!== 'false');
    Logger.log(`Generating JS fallback (tsc): ${tsCommand.command} ${fallbackArgs.join(' ')}`);
    const fallbackResult = core.runExternalCommand(tsCommand.command, fallbackArgs, workspacePath);
    if (!fallbackResult.ok) warnMissing += ' | Warning: TS Runtime Errors';
  }

  // 3. Post-processing (Watermarks & Lock suffixes)
  const addWatermark = config.get('addWatermark', true);
  
  for (const owner of owners) {
    const pathsData = core.predictEmitPaths(owner.entryAbs, owner.outBaseRel, workspacePath, lockSuffixes);
    
    // Rename logic for lock suffixes (from _raw to final)
    const isLockEntry = lockSuffixes.some(s => owner.entryAbs.endsWith(s));
    if (isLockEntry) {
      const rawPaths = core.predictEmitPaths(owner.entryAbs, owner.outBaseRel, workspacePath, lockSuffixes, true);
      await delay(100);
      try {
        if (fs.existsSync(rawPaths.jsPath)) {
          await vscode.workspace.fs.rename(vscode.Uri.file(rawPaths.jsPath), vscode.Uri.file(pathsData.jsPath), { overwrite: true });
        }
        if (fs.existsSync(rawPaths.dtsPath)) {
          await vscode.workspace.fs.rename(vscode.Uri.file(rawPaths.dtsPath), vscode.Uri.file(pathsData.dtsPath), { overwrite: true });
        }
      } catch (e) {
        Logger.error('Rename error', e.message);
      }
    }

    if (addWatermark) {
      const jsRelSource = path.relative(path.dirname(pathsData.jsPath), owner.entryAbs).replace(/\\/g, '/');
      const dtsRelSource = path.relative(path.dirname(pathsData.dtsPath), owner.entryAbs).replace(/\\/g, '/');
      
      try {
        if (fs.existsSync(pathsData.jsPath)) {
          const contentBuf = await vscode.workspace.fs.readFile(vscode.Uri.file(pathsData.jsPath));
          const watermarked = core.prependWatermark(Buffer.from(contentBuf).toString('utf8'), jsRelSource);
          await vscode.workspace.fs.writeFile(vscode.Uri.file(pathsData.jsPath), Buffer.from(watermarked, 'utf8'));
        }
        if (fs.existsSync(pathsData.dtsPath)) {
          const contentBuf = await vscode.workspace.fs.readFile(vscode.Uri.file(pathsData.dtsPath));
          const watermarked = core.prependWatermark(Buffer.from(contentBuf).toString('utf8'), dtsRelSource);
          await vscode.workspace.fs.writeFile(vscode.Uri.file(pathsData.dtsPath), Buffer.from(watermarked, 'utf8'));
        }
      } catch (e) {}
    }
  }

  if (config.get('showNotifications', true) || notify) {
    vscode.window.showInformationMessage(`[Forge] Successfully built ${owners.length} file(s) via ${runtime}.${warnMissing}`);
  }
}

module.exports = { scheduleEmit };
