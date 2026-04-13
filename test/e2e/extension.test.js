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
