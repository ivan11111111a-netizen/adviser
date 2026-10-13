import * as vscode from 'vscode';
import { setApiKey } from './config/provider';
import { Findings } from './editor/findings';
import { hoverProvider, REVEAL_COMMAND, revealStep, type RevealArgs } from './editor/hover';
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
    // Не объявлена в package.json, поэтому её нет в палитре: её зовут только кнопки в hover.
    vscode.commands.registerCommand(REVEAL_COMMAND, (args?: RevealArgs) =>
      revealStep(findings, log, args),
    ),
    vscode.languages.registerHoverProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }],
      hoverProvider(findings),
    ),
  );
}

export function deactivate() {}
