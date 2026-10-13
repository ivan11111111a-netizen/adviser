import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('adviser.hello', () => {
      vscode.window.showInformationMessage('Adviser запущен.');
    }),
  );
}

export function deactivate() {}
