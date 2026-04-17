/**
 * E2E Extension Tests — MUST run inside the VS Code Extension Host.
 * Run via: npm run test:e2e  (uses @vscode/test-electron + Mocha)
 * 
 * DO NOT run with: bun test  (Mocha's suite() is not available in Bun)
 */

// Guard: if suite() is not defined, we're outside the Extension Host.
// Bail out early with instructions rather than crashing with a confusing error.
if (typeof suite === 'undefined') {
    console.error([
        '',
        '⚠️  E2E test loaded outside VS Code Extension Host.',
        '   These tests require the full VS Code runtime.',
        '   Run them with:  npm run test:e2e',
        '   Unit tests run with:  npm run test:bun',
        '',
    ].join('\n'));
    // Exit without executing — don't throw, don't crash the test runner
    module.exports = {};
} else {
    const assert = require('assert');
    const vscode = require('vscode');

    suite('Extension Test Suite', () => {
        vscode.window.showInformationMessage('Start all tests.');

        test('Extension should be present', () => {
            assert.ok(vscode.extensions.getExtension('tuadmin.forge-typelayer'));
        });

        test('should activate and register toggleMode command', async () => {
            const ext = vscode.extensions.getExtension('tuadmin.forge-typelayer');
            if (!ext.isActive) {
                await ext.activate();
            }
            const commands = await vscode.commands.getCommands(true);
            const hasCommand = commands.some(c => c === 'forgeTypeLayer.toggleMode');
            assert.ok(hasCommand, 'Command forgeTypeLayer.toggleMode not found in registered commands');
        });
    });
}
