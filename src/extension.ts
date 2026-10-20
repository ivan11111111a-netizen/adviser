import * as vscode from 'vscode';
import { setApiKey } from './config/provider';
import { Autopilot } from './editor/autopilot';
import { Findings } from './editor/findings';
import {
  hoverProvider,
  OPEN_CASE_COMMAND,
  openCase,
  REVEAL_COMMAND,
  revealStep,
  type CaseArgs,
  type RevealArgs,
} from './editor/hover';
import { Journal } from './editor/journal';
import { reviewFunction } from './editor/reviewCommand';
import { Reviewer } from './editor/reviewer';
import { MENU_COMMAND, showMenu, StatusBar } from './editor/statusBar';

/** Что видят интеграционные тесты. Только в режиме тестов: журнал не отдаём другим расширениям. */
export interface TestApi {
  journal: Journal;
}

let journal: Journal | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<TestApi | undefined> {
  const log = vscode.window.createOutputChannel('Adviser', { log: true });
  journal = await Journal.open(context, log);
  const findings = new Findings(journal);
  const reviewer = new Reviewer(context, log);
  const status = new StatusBar(context);
  const autopilot = new Autopilot(context, reviewer, findings, status, log);
  context.subscriptions.push(
    log,
    journal,
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
    // Не объявлены в package.json, поэтому их нет в палитре: их зовут только ссылки в hover.
    vscode.commands.registerCommand(REVEAL_COMMAND, (args?: RevealArgs) =>
      revealStep(findings, log, args),
    ),
    vscode.commands.registerCommand(OPEN_CASE_COMMAND, (args?: CaseArgs) => openCase(log, args)),
    vscode.languages.registerHoverProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }],
      hoverProvider(findings, journal),
    ),
  );
  return context.extensionMode === vscode.ExtensionMode.Test ? { journal } : undefined;
}

/** Журнал пишется с задержкой — дописываем то, что не успело уйти на диск. */
export function deactivate() {
  return journal?.flush();
}
