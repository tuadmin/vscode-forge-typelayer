const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function findUp(startDir, names) {
  let dir = startDir;
  while (dir && dir !== path.dirname(dir)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fileExists(candidate)) return candidate;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function detectProjectHints(workspacePath) {
  return {
    denoConfig: findUp(workspacePath, ['deno.json', 'deno.jsonc']),
    bunConfig: findUp(workspacePath, ['bun.lockb', 'bun.lock', 'bunfig.toml']),
    tsconfig: findUp(workspacePath, ['tsconfig.json']),
    jsconfig: findUp(workspacePath, ['jsconfig.json']),
    packageJson: findUp(workspacePath, ['package.json'])
  };
}

function hasCommand(command) {
  try {
    const probe = process.platform === 'win32' ? `where ${command}` : `command -v ${command}`;
    cp.execSync(probe, { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

function getLocalTscPath(workspacePath) {
  return path.join(workspacePath, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
}

function resolveRuntimePreference(options) {
  const preferred = options.preferredRuntime || 'auto';
  const workspacePath = options.workspacePath;
  const hints = detectProjectHints(workspacePath);
  const localTsc = getLocalTscPath(workspacePath);

  if (preferred !== 'auto') return { runtime: preferred, hints, reason: `Explicit preference: ${preferred}` };
  if (hints.denoConfig && hasCommand('deno')) return { runtime: 'deno', hints, reason: `Detected Deno config at ${hints.denoConfig}` };
  if (hints.bunConfig && hasCommand('bun')) return { runtime: 'bun', hints, reason: `Detected Bun config at ${hints.bunConfig}` };
  if (fileExists(localTsc)) return { runtime: 'tsc', hints, reason: `Detected local tsc at ${localTsc}` };
  if (hasCommand('tsc')) return { runtime: 'tsc', hints, reason: 'Detected global tsc' };
  return { runtime: 'typescript-api', hints, reason: 'Falling back to embedded TypeScript API' };
}

function resolveManifest(workspacePath, entriesFile) {
  const manifestPath = path.join(workspacePath, entriesFile || 'forge-typelayer.entries.json');
  if (!fileExists(manifestPath)) return { manifestPath, entries: {} };
  const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { manifestPath, entries: json.entries || {} };
}

/**
 * Architectural Core: resolveOwningEntryByFile
 * Escanea el archivo editado y decide si debe activar una emisión.
 * Primero busca en el `forge-typelayer.entries.json` para saber si es un punto de entrada público.
 * Si no está declarado, pero es independiente (.ts/.mts), aplica la lógica Zero-Config (asumiéndolo como auto-entrypoint).
 */
function resolveOwningEntryByFile(workspacePath, entriesFile, filePath) {
  const { entries } = resolveManifest(workspacePath, entriesFile);
  const absDoc = path.resolve(filePath);
  
  // 1. Manifest Match Check (Para ecosistemas grandes o estrictos)
  for (const [entryRel, outBaseRel] of Object.entries(entries)) {
    const entryAbs = path.resolve(workspacePath, entryRel);
    const entryDir = path.dirname(entryAbs);
    if (absDoc === entryAbs || absDoc.startsWith(entryDir + path.sep)) {
      return { entryAbs, outBaseRel };
    }
  }
  
  // 2. Zero-Config Auto-Fallback: Si no hay manifiesto, el archivo TS/MTS suelto
  // se trata como su propio "entrypoint" emitiendo gemelos adjuntos al archivo original.
  if (absDoc.match(/\.(ts|mts|cts)$/i)) {
    return { entryAbs: absDoc, outBaseRel: path.relative(workspacePath, absDoc) };
  }

  return null;
}

function buildReconstructedSource(jsText, dtsText, jsName) {
  return `/**\n * Reconstructed draft source from public artifacts.\n * Source JS: ${jsName}\n * This file is assistive and lossy; review manually.\n */\n\n${dtsText ? `/* Adjacent type declarations snapshot\n${dtsText.replace(/\*\//g, '* /')}\n*/\n\n` : ''}${jsText}`;
}

function buildRuntimeCommand(runtime, ctx) {
  const { workspacePath, entryAbs, outBaseAbs, config } = ctx;
  const outDir = path.dirname(outBaseAbs);
  const rootDir = path.dirname(entryAbs);
  const target = config.target || 'ES2022';
  const removeComments = !!config.removeComments;
  const commonArgs = [
    entryAbs,
    '--declaration',
    '--emitDeclarationOnly', 'false',
    '--outDir', outDir,
    '--rootDir', rootDir,
    '--target', target,
    '--removeComments', String(removeComments),
    '--skipLibCheck', 'true',
    '--esModuleInterop', 'true',
    '--allowJs', 'true'
  ];

  if (entryAbs.endsWith('.mts')) commonArgs.push('--module', 'es2022', '--moduleResolution', 'bundler', '--rewriteRelativeImportExtensions', 'true');
  else commonArgs.push('--module', 'commonjs', '--moduleResolution', 'node');

  if (runtime === 'tsc') {
    const localTsc = getLocalTscPath(workspacePath);
    return { command: fileExists(localTsc) ? localTsc : 'tsc', args: commonArgs, mode: 'external' };
  }
  if (runtime === 'bun') return { command: 'bunx', args: ['tsc', ...commonArgs], mode: 'external' };
  if (runtime === 'deno') return { command: 'deno', args: ['run', '-A', 'npm:typescript/bin/tsc', ...commonArgs], mode: 'external-fallback-capable' };
  return { command: null, args: [], mode: 'api' };
}

function runExternalCommand(command, args, cwd) {
  try {
    cp.execFileSync(command, args, { cwd, stdio: 'pipe' });
    return { ok: true, status: 0, stdout: '', stderr: '' };
  } catch (error) {
    return { 
      ok: false, 
      status: error.status || 0,
      stdout: error.stdout ? String(error.stdout) : '', 
      stderr: error.stderr ? String(error.stderr) : error.message 
    };
  }
}

function detectLintStrategy(workspacePath, runtime) {
  const eslintConfig = findUp(workspacePath, ['eslint.config.js', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json']);
  const localEslint = path.join(workspacePath, 'node_modules', '.bin', process.platform === 'win32' ? 'eslint.cmd' : 'eslint');
  if (eslintConfig && fileExists(localEslint)) return { kind: 'eslint-binary', command: localEslint, reason: `Detected local ESLint and config at ${eslintConfig}` };
  if (eslintConfig && hasCommand('eslint')) return { kind: 'eslint-binary', command: 'eslint', reason: `Detected global ESLint and config at ${eslintConfig}` };
  if (runtime === 'deno' && hasCommand('deno')) return { kind: 'deno-lint', command: 'deno', reason: 'Deno-oriented workspace lint path' };
  return { kind: 'none', command: null, reason: 'No dedicated lint tool detected; rely on validation fallback' };
}

function buildLintCommand(strategy, filePath) {
  if (strategy.kind === 'eslint-binary') return { command: strategy.command, args: [filePath], mode: 'lint' };
  if (strategy.kind === 'deno-lint') return { command: 'deno', args: ['lint', filePath], mode: 'lint' };
  return { command: null, args: [], mode: 'none' };
}

function runMinimalValidation(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const noComments = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').trim();
    if (!noComments) return { ok: false, reason: 'File contains only comments or whitespace.' };
    return { ok: true, reason: 'Minimal validation passed.' };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

function prependWatermark(content, sourceFilename) {
  if (!content) return content;
  const seeLoc = sourceFilename ? ` | @see {@link ${sourceFilename}}` : '';
  const watermark = `/** @generated Forge TypeLayer | DO NOT EDIT DIRECTLY${seeLoc} */\n`;
  return `${watermark}${content}`;
}

function preflightWorkspaceChecks(workspacePath, runtime, entriesFile = 'forge-typelayer.entries.json') {
  const hints = detectProjectHints(workspacePath);
  const warnings = [];
  if (!fileExists(path.join(workspacePath, entriesFile))) warnings.push('Manifest file is missing.');
  if (runtime === 'deno' && !hints.denoConfig) warnings.push('Deno runtime selected but no deno.json/deno.jsonc detected.');
  if (runtime === 'bun' && !hints.bunConfig) warnings.push('Bun runtime selected but no Bun workspace signal detected.');
  return { ok: true, warnings, hints };
}

function extractEmittedAssets(outputs) {
  let jsPath = null;
  let jsContent = '';
  let dtsPath = null;
  let dtsContent = '';

  for (const [filePath, content] of outputs.entries()) {
    if (filePath.match(/\.(js|mjs|cjs)$/i)) {
      jsPath = filePath;
      jsContent = content;
    } else if (filePath.match(/\.d\.(ts|mts|cts)$/i)) {
      dtsPath = filePath;
      dtsContent = content;
    }
  }

  return { jsPath, jsContent, dtsPath, dtsContent };
}

function predictEmitPaths(entryAbs, outBaseRel, workspacePath, preserveRaw = false) {
  const outBaseAbs = path.resolve(workspacePath, outBaseRel);
  const outDir = path.dirname(outBaseAbs);
  const baseName = path.basename(entryAbs);
  
  let jsExt = '.js';
  let dtsExt = '.d.ts';
  if (baseName.endsWith('.mts')) {
    jsExt = '.mjs';
    dtsExt = '.d.mts';
  }
  
  // Surgical extraction: Remove the lock prefix .f. only if we are not preserving raw output names
  const prefix = preserveRaw 
    ? baseName.replace(/\.(ts|mts)$/i, '') 
    : baseName.replace(/\.(f\.)?(ts|mts)$/i, ''); 
  return {
    jsPath: path.join(outDir, `${prefix}${jsExt}`),
    dtsPath: path.join(outDir, `${prefix}${dtsExt}`),
    outDir
  };
}

function buildDoctorReport(workspacePath, runtime, entriesFile = 'forge-typelayer.entries.json') {
  const runtimeInfo = resolveRuntimePreference({ workspacePath, preferredRuntime: runtime || 'auto' });
  const lintInfo = detectLintStrategy(workspacePath, runtimeInfo.runtime);
  const preflight = preflightWorkspaceChecks(workspacePath, runtimeInfo.runtime, entriesFile);
  const manifest = resolveManifest(workspacePath, entriesFile);
  return {
    runtime: runtimeInfo,
    lint: lintInfo,
    preflight,
    manifestPath: manifest.manifestPath,
    hints: preflight.hints
  };
}

module.exports = {
  fileExists,
  findUp,
  detectProjectHints,
  hasCommand,
  getLocalTscPath,
  resolveRuntimePreference,
  resolveManifest,
  resolveOwningEntryByFile,
  buildReconstructedSource,
  buildRuntimeCommand,
  runExternalCommand,
  detectLintStrategy,
  buildLintCommand,
  runMinimalValidation,
  preflightWorkspaceChecks,
  buildDoctorReport,
  extractEmittedAssets,
  predictEmitPaths,
  prependWatermark
};
