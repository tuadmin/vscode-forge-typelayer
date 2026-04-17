const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const SYSTEM_CAPABILITIES = {
  isWin: process.platform === 'win32',
  shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  probeCmd: (cmd) => process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`,
  versionCmd: (cmd) => `${cmd} --version`,
  // Unified quoting strategy following our shell.js patterns
  quote: (arg) => {
    if (process.platform === 'win32') {
      // CMD: double quotes, escape internal quotes by doubling
      return `"${arg.replace(/"/g, '""')}"`;
    }
    // Unix: single quotes, escape internal single quotes
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
};

const COMPATIBILITY_REGISTRY = {
  bun: '1.0.0',
  deno: '1.40.0',
  tsc: '5.0.0'
};

/**
 * Poor man's semver comparison. Handles '1.2.3' vs '1.2.0'.
 * Returns true if current >= minimum.
 */
function isVersionAtLeast(current, minimum) {
  if (!current || !minimum) return false;
  const c = current.replace(/[^\d.]/g, '').split('.').map(Number);
  const m = minimum.replace(/[^\d.]/g, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const cv = c[i] || 0;
    const mv = m[i] || 0;
    if (cv > mv) return true;
    if (cv < mv) return false;
  }
  return true;
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
    const probe = SYSTEM_CAPABILITIES.probeCmd(command);
    cp.execSync(probe, { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

function getLocalTscPath(workspacePath) {
  return path.join(workspacePath, 'node_modules', '.bin', SYSTEM_CAPABILITIES.isWin ? 'tsc.cmd' : 'tsc');
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

  const denoEnabledInConfig = hints.denoConfig && isDenoEnabled(hints.denoConfig);
  const denoEnabledInVSCode = fileExists(hints.vscodeSettings) && isDenoEnabled(hints.vscodeSettings);

  if (hasCommand('deno') && (denoEnabledInConfig || denoEnabledInVSCode)) {
    const source = denoEnabledInConfig ? hints.denoConfig : hints.vscodeSettings;
    return { runtime: 'deno', hints, reason: `Detected Deno with explicit enable in ${source}` };
  }

  if (hints.bunConfig && hasCommand('bun')) return { runtime: 'bun', hints, reason: `Detected Bun config at ${hints.bunConfig}` };

  if (fileExists(localTsc)) return { runtime: 'tsc', hints, reason: `Detected local tsc at ${localTsc}` };
  if (hasCommand('tsc')) return { runtime: 'tsc', hints, reason: 'Detected global tsc' };

  if (hints.denoConfig && hasCommand('deno')) return { runtime: 'deno', hints, reason: `Detected Deno config at ${hints.denoConfig} (implicit)` };

  return { runtime: 'typescript-api', hints, reason: 'Falling back to embedded TypeScript API' };
}

function resolveManifest(workspacePath, entriesFile) {
  const manifestPath = path.join(workspacePath, entriesFile || 'forge-typelayer.entries.json');
  if (!fileExists(manifestPath)) return { manifestPath, entries: {} };
  const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { manifestPath, entries: json.entries || {} };
}

function readJsonC(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const clean = content.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

function extractAliases(workspacePath) {
  const aliases = { paths: {}, imports: {}, baseUrl: '.' };
  
  const configs = [path.join(workspacePath, 'tsconfig.json'), path.join(workspacePath, 'jsconfig.json')];
  for (const cfgPath of configs) {
    const json = readJsonC(cfgPath);
    if (json?.compilerOptions?.paths) {
      Object.assign(aliases.paths, json.compilerOptions.paths);
      if (json.compilerOptions.baseUrl) aliases.baseUrl = json.compilerOptions.baseUrl;
    }
  }

  const denoConfigs = [path.join(workspacePath, 'deno.json'), path.join(workspacePath, 'import_map.json')];
  for (const cfgPath of denoConfigs) {
    const json = readJsonC(cfgPath);
    if (json?.imports) {
      Object.assign(aliases.imports, json.imports);
    }
  }

  return aliases;
}

function resolveOwningEntryByFile(workspacePath, entriesFile, filePath, lockSuffixes = ['.f.ts', '.source.ts']) {
  const { entries } = resolveManifest(workspacePath, entriesFile);
  const absDoc = path.resolve(filePath);
  
  for (const [entryRel, outBaseRel] of Object.entries(entries)) {
    const entryAbs = path.resolve(workspacePath, entryRel);
    const entryDir = path.dirname(entryAbs);
    if (absDoc === entryAbs || absDoc.startsWith(entryDir + path.sep)) {
      return { entryAbs, outBaseRel };
    }
  }
  
  const isLockFile = lockSuffixes.some(s => absDoc.endsWith(s));
  if (isLockFile || absDoc.match(/\.(ts|mts)$/i)) {
    return { entryAbs: absDoc, outBaseRel: path.relative(workspacePath, absDoc) };
  }

  return null;
}

function buildReconstructedSource(jsText, dtsText, jsName) {
  return `/**\n * Reconstructed draft source from public artifacts.\n * Source JS: ${jsName}\n * This file is assistive and lossy; review manually.\n */\n\n${dtsText ? `/* Adjacent type declarations snapshot\n${dtsText.replace(/\*\//g, '* /')}\n*/\n\n` : ''}${jsText}`;
}

function preflightWorkspaceChecks(workspacePath, runtime, entriesFile = 'forge-typelayer.entries.json') {
  const hints = detectProjectHints(workspacePath);
  const warnings = [];
  if (!fileExists(path.join(workspacePath, entriesFile))) warnings.push('Manifest file is missing.');
  if (runtime === 'deno' && !hints.denoConfig) warnings.push('Deno runtime selected but no deno.json/deno.jsonc detected.');
  if (runtime === 'bun' && !hints.bunConfig) warnings.push('Bun runtime selected but no Bun workspace signal detected.');
  return { ok: true, warnings, hints };
}

function buildDoctorReport(workspacePath, runtime, entriesFile = 'forge-typelayer.entries.json', healthInfo = null) {
  const runtimeInfo = resolveRuntimePreference({ workspacePath, preferredRuntime: runtime || 'auto' });
  const preflight = preflightWorkspaceChecks(workspacePath, runtimeInfo.runtime, entriesFile);
  const manifest = resolveManifest(workspacePath, entriesFile);
  return {
    runtime: runtimeInfo,
    health: healthInfo || { ok: true, binary: { ok: true }, filesystem: { ok: true } },
    lint: { kind: 'none', command: null, reason: 'Linting moved to separate validation engine' },
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
  preflightWorkspaceChecks,
  buildDoctorReport,
  readJsonC,
  extractAliases,
  SYSTEM_CAPABILITIES,
  COMPATIBILITY_REGISTRY,
  isVersionAtLeast
};
