import * as vscode from 'vscode';
import { setApiKey } from './config/provider';
import { Findings, hoverProvider } from './editor/findings';
import { reviewFunction } from './editor/reviewCommand';

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Adviser', { log: true });
  const findings = new Findings();
  context.subscriptions.push(
    log,
    findings,
    vscode.commands.registerCommand('adviser.reviewFunction', () =>
      reviewFunction(context, findings, log),
    ),
    vscode.commands.registerCommand('adviser.setApiKey', () => setApiKey(context)),
    vscode.languages.registerHoverProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }],
      hoverProvider(findings),
    ),
  );
}

export function deactivate() {}
