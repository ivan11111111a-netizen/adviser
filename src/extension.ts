import * as vscode from 'vscode';
import { setApiKey } from './config/provider';
import { Autopilot } from './editor/autopilot';
import { Findings } from './editor/findings';
import { hoverProvider, REVEAL_COMMAND, revealStep, type RevealArgs } from './editor/hover';
import { reviewFunction } from './editor/reviewCommand';
import { Reviewer } from './editor/reviewer';
import { MENU_COMMAND, showMenu, StatusBar } from './editor/statusBar';

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Adviser', { log: true });
  const findings = new Findings();
  const reviewer = new Reviewer(context, log);
  const status = new StatusBar(context);
  const autopilot = new Autopilot(context, reviewer, findings, status, log);
  context.subscriptions.push(
    log,
    findings,
    status,
    autopilot,
    vscode.commands.registerCommand('adviser.reviewFunction', () =>
      reviewFunction(reviewer, findings, status, log, (doc, code) =>
        autopilot.reviewedByCommand(doc, code),
      ),
    ),
    vscode.commands.registerCommand('adviser.setApiKey', () => setApiKey(context)),
    vscode.commands.registerCommand(MENU_COMMAND, () => showMenu(context, autopilot, log)),
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
