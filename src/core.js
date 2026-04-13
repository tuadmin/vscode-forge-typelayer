const fs = require('fs');
const path = require('path');
const cp = require('child_process');

/**
 * Determines if a file is an internal sub-module that should be kept during encapsulation.
 */
function isInternalSubModule(filePath, entryDir) {
  const absPath = path.resolve(filePath);
  const absEntryDir = path.resolve(entryDir);
  const baseName = path.basename(absPath);
  
  // Must start with _
  if (!baseName.startsWith('_')) return false;
  
  // Must be in the same directory or a child directory
  return absPath.startsWith(absEntryDir);
}

/**
 * Returns a bundler command ( Bun build / Deno bundle ) if supported by the runtime.
 */
function getBundlerCommand(runtime, entryAbs, outAbs, projectContext = {}) {
  const { paths = {} } = projectContext;
  
  // Create externalization flags for all aliases
  const externalFlags = [];
  for (const alias in paths) {
    // Bun/Deno handle '*' differently, but usually the root alias is what matters
    const cleanAlias = alias.replace(/\*$/, '');
    if (cleanAlias) externalFlags.push(cleanAlias);
  }

  if (runtime === 'bun') {
    return {
      command: 'bun',
      args: [
        'build', entryAbs, 
        '--outfile', outAbs, 
        '--target', 'node',
        // Externalize all project aliases
        ...externalFlags.flatMap(f => ['--external', f]),
        // Externalize parents to avoid inlining shared helpers
        '--external', '../*'
      ],
      mode: 'external'
    };
  }
  if (runtime === 'deno') {
    // Note: Deno bundle is simpler but less configurable via CLI for selective externalization
    // Usually respects import maps.
    return {
      command: 'deno',
      args: ['bundle', entryAbs, outAbs],
      mode: 'external'
    };
  }
  return null;
}

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
    packageJson: findUp(workspacePath, ['package.json']),
    vscodeSettings: path.join(workspacePath, '.vscode', 'settings.json')
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

function isDenoEnabled(configPath) {
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const json = JSON.parse(content);
    return json['deno.enable'] === true || json['deno.enabled'] === true || json['enable'] === true;
  } catch {
    return false;
  }
}

function resolveRuntimePreference(options) {
  const preferred = options.preferredRuntime || 'auto';
  const workspacePath = options.workspacePath;
  const hints = detectProjectHints(workspacePath);
  const localTsc = getLocalTscPath(workspacePath);

  if (preferred !== 'auto') return { runtime: preferred, hints, reason: `Explicit preference: ${preferred}` };

  // 1. Deno Priority (Strict check if enabled in config or VS Code settings)
  const denoEnabledInConfig = hints.denoConfig && isDenoEnabled(hints.denoConfig);
  const denoEnabledInVSCode = fileExists(hints.vscodeSettings) && isDenoEnabled(hints.vscodeSettings);

  if (hasCommand('deno') && (denoEnabledInConfig || denoEnabledInVSCode)) {
    const source = denoEnabledInConfig ? hints.denoConfig : hints.vscodeSettings;
    return { runtime: 'deno', hints, reason: `Detected Deno with explicit enable in ${source}` };
  }

  // 2. Bun Priority
  if (hints.bunConfig && hasCommand('bun')) return { runtime: 'bun', hints, reason: `Detected Bun config at ${hints.bunConfig}` };

  // 3. TSC (Local then Global)
  if (fileExists(localTsc)) return { runtime: 'tsc', hints, reason: `Detected local tsc at ${localTsc}` };
  if (hasCommand('tsc')) return { runtime: 'tsc', hints, reason: 'Detected global tsc' };

  // 4. Deno Fallback (If config exists but not explicitly enabled, still check if it's a Deno workspace)
  if (hints.denoConfig && hasCommand('deno')) return { runtime: 'deno', hints, reason: `Detected Deno config at ${hints.denoConfig} (implicit)` };

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
/**
 * Loads and parses JSON that may contain comments (JSONC).
 */
function readJsonC(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Simple regex to strip comments for basic JSONC parsing
    const clean = content.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

/**
 * Extracts aliases/paths from various project config formats.
 */
function extractAliases(workspacePath) {
  const aliases = { paths: {}, imports: {}, baseUrl: '.' };
  
  // 1. TS/JS Config
  const configs = [path.join(workspacePath, 'tsconfig.json'), path.join(workspacePath, 'jsconfig.json')];
  for (const cfgPath of configs) {
    const json = readJsonC(cfgPath);
    if (json?.compilerOptions?.paths) {
      Object.assign(aliases.paths, json.compilerOptions.paths);
      if (json.compilerOptions.baseUrl) aliases.baseUrl = json.compilerOptions.baseUrl;
    }
  }

  // 2. Deno Config / Import Map
  const denoConfigs = [path.join(workspacePath, 'deno.json'), path.join(workspacePath, 'import_map.json')];
  for (const cfgPath of denoConfigs) {
    const json = readJsonC(cfgPath);
    if (json?.imports) {
      Object.assign(aliases.imports, json.imports);
    }
  }

  return aliases;
}

function resolveOwningEntryByFile(workspacePath, entriesFile, filePath, lockSuffixes = ['.f.ts']) {
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
  const isLockFile = lockSuffixes.some(s => absDoc.endsWith(s));
  if (isLockFile || absDoc.match(/\.(ts|mts)$/i)) {
    return { entryAbs: absDoc, outBaseRel: path.relative(workspacePath, absDoc) };
  }

  return null;
}

function buildReconstructedSource(jsText, dtsText, jsName) {
  return `/**\n * Reconstructed draft source from public artifacts.\n * Source JS: ${jsName}\n * This file is assistive and lossy; review manually.\n */\n\n${dtsText ? `/* Adjacent type declarations snapshot\n${dtsText.replace(/\*\//g, '* /')}\n*/\n\n` : ''}${jsText}`;
}

/**
 * Generates the object structure for a synthetic tsconfig.
 */
function buildSyntheticConfig(workspacePath, projectContext, options = {}) {
  const { paths, baseUrl } = projectContext;
  return {
    compilerOptions: {
      target: options.target || 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ESNext', 'DOM'],
      skipLibCheck: true,
      esModuleInterop: true,
      allowJs: true,
      removeComments: !!options.removeComments,
      declaration: true,
      emitDeclarationOnly: false,
      baseUrl: baseUrl || '.',
      paths: paths || {},
      // Inhibit picking up the workspace tsconfig.json to avoid collisions
      ignoreConfig: true,
      outDir: options.outDir || '.',
      rootDir: options.rootDir || workspacePath
    },
    files: options.entryFile ? [options.entryFile] : []
  };
}

function buildSyntheticConfigPath(workspacePath) {
  return path.join(workspacePath, '.vscode', 'forge-typelayer.tsconfig.json');
}

function buildRuntimeCommand(runtime, ctx) {
  const { workspacePath, entryAbs, outBaseAbs, config } = ctx;
  const outDir = config.outDir || path.dirname(outBaseAbs);
  const rootDir = config.rootDir || path.dirname(entryAbs);
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
    '--allowJs', 'true',
    '--lib', 'ESNext,DOM',
    '--ignoreConfig'
  ];

  // Robust Emission Strategy: Avoid 'bundler' or 'node10' resolution
  // We use NodeNext to ensure compatibility with modern Bun/Deno and fix deprecations.
  commonArgs.push('--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--rewriteRelativeImportExtensions', 'true');

  if (runtime === 'tsc') {
    const localTsc = getLocalTscPath(workspacePath);
    return { command: fileExists(localTsc) ? localTsc : 'tsc', args: commonArgs, mode: 'external' };
  }
  if (runtime === 'bun') return { command: 'bunx', args: ['tsc', ...commonArgs], mode: 'external' };
  if (runtime === 'deno') {
    // Inject --import-map if we have a hint or settings
    const hints = detectProjectHints(workspacePath);
    const args = ['run', '-A'];
    const settings = fileExists(hints.vscodeSettings) ? readJsonC(hints.vscodeSettings) : null;
    const importMap = settings?.['deno.importMap'] || (fileExists(path.join(workspacePath, 'import_map.json')) ? './import_map.json' : null);
    if (importMap) args.push('--import-map', importMap);
    
    args.push('npm:typescript/bin/tsc', ...commonArgs);
    return { command: 'deno', args, mode: 'external-fallback-capable' };
  }
  return { command: null, args: [], mode: 'api' };
}

function runExternalCommand(command, args, cwd) {
  try {
    const stdout = cp.execFileSync(command, args, { cwd, stdio: 'pipe' });
    return { ok: true, status: 0, stdout: stdout.toString(), stderr: '' };
  } catch (error) {
    return { 
      ok: false, 
      status: error.status || 0,
      stdout: error.stdout ? error.stdout.toString() : '',
      stderr: error.stderr ? error.stderr.toString() : error.message
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

function prependWatermark(content, sourcePath) {
  if (!content) return content;
  const safePath = (sourcePath.startsWith('.') || sourcePath.startsWith('/')) ? sourcePath : `./${sourcePath}`;
  const banner = `/** @generated Forge TypeLayer | DO NOT EDIT DIRECTLY */\n/// <reference path="${safePath}" />\n\n`;
  return banner + content;
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

function predictEmitPaths(entryAbs, outBaseRel, workspacePath, lockSuffixes = ['.f.ts'], preserveRaw = false) {
  // Backward compatibility guard: if 4th arg is boolean, treat it as preserveRaw
  if (typeof lockSuffixes === 'boolean') {
    preserveRaw = lockSuffixes;
    lockSuffixes = ['.f.ts'];
  }
  const outBaseAbs = path.resolve(workspacePath, outBaseRel);
  const outDir = path.dirname(outBaseAbs);
  const baseName = path.basename(entryAbs);
  
  let jsExt = '.js';
  let dtsExt = '.d.ts';
  if (baseName.endsWith('.mts')) {
    jsExt = '.mjs';
    dtsExt = '.d.mts';
  }
  
  let prefix = baseName.replace(/\.(ts|mts)$/i, '');
  
  if (!preserveRaw) {
    // Find the longest matching suffix to strip
    const matchedSuffix = lockSuffixes
      .filter(s => baseName.endsWith(s))
      .sort((a, b) => b.length - a.length)[0];
    
    if (matchedSuffix) {
      prefix = baseName.slice(0, -matchedSuffix.length);
    }
  }

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
  prependWatermark,
  readJsonC,
  extractAliases,
  buildSyntheticConfig,
  buildSyntheticConfigPath,
  isInternalSubModule,
  getBundlerCommand
};
