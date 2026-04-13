const path = require('path');
const fs = require('fs');
const { runTests } = require('@vscode/test-electron');

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
    const extensionTestsPath = path.resolve(__dirname, './e2e/index.js');
    const workspace = path.resolve(__dirname, '../test-fixtures/workspace');

    // Create unique temporary directories to ensure a clean state and avoid global extension conflicts
    const testDataDir = path.join(__dirname, '..', '.vscode-test', 'user-data-' + Date.now());
    const testExtensionsDir = path.join(__dirname, '..', '.vscode-test', 'extensions-' + Date.now());

    fs.mkdirSync(testDataDir, { recursive: true });
    fs.mkdirSync(testExtensionsDir, { recursive: true });

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--disable-gpu',
        '--user-data-dir', testDataDir,
        '--extensions-dir', testExtensionsDir
      ]
    });
  } catch (err) {
    console.error('Test run failed:', err);
    process.exit(1);
  } finally {
    // Note: We leave directories for debug if failed, or could clean here
  }
}

main();
