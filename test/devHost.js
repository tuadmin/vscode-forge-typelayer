/**
 * Development Host Launcher
 * Spawns a clean, isolated VS Code instance with Forge TypeLayer pre-loaded.
 * Use this for manual verification and debugging across different environments.
 */
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

async function main() {
  try {
    console.log('--- Forge TypeLayer: Launching isolated Dev Host ---');
    
    // 1. Resolve paths
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
    const workspacePath = path.resolve(__dirname, '../test-fixtures/workspace');
    
    // 2. Prep isolated environment
    const testRoot = path.join(extensionDevelopmentPath, '.vscode-test');
    if (!fs.existsSync(testRoot)) fs.mkdirSync(testRoot, { recursive: true });
    
    const userDataDir = path.join(testRoot, 'dev-user-data');
    const extensionsDir = path.join(testRoot, 'dev-extensions');
    
    // We don't necessarily delete these every time to keep it fast, 
    // but the clean download ensures core VS Code is stable.
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    if (!fs.existsSync(extensionsDir)) fs.mkdirSync(extensionsDir, { recursive: true });

    // 3. Download VS Code (if missing) and get executable path
    const vscodeExecutablePath = await downloadAndUnzipVSCode();

    console.log(`Executable: ${vscodeExecutablePath}`);
    console.log(`Workspace: ${workspacePath}`);
    console.log('--------------------------------------------------');

    // 4. Spawn the instance
    const args = [
      workspacePath,
      `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--disable-gpu' // Stability on some environments
    ];

    const child = cp.spawn(vscodeExecutablePath, args, {
      stdio: 'inherit',
      detached: false
    });

    child.on('error', (err) => {
      console.error('Failed to start VS Code Dev Host:', err);
    });

    child.on('exit', (code) => {
      console.log(`Dev Host exited with code ${code}`);
      process.exit(code || 0);
    });

  } catch (err) {
    console.error('Launch failed:', err);
    process.exit(1);
  }
}

main();
