import * as vscode from 'vscode';
import { setApiKey } from './config/provider';
import { learnerProfile } from './core/journal';
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
import { readPatterns } from './editor/bundled';
import { Journal } from './editor/journal';
import { JournalView, REPORT_COMMAND, showWeeklyReport } from './editor/journalView';
import { reviewFunction } from './editor/reviewCommand';
import { Reviewer } from './editor/reviewer';
import { ProjectSettings } from './editor/settings';
import { MENU_COMMAND, showMenu, StatusBar } from './editor/statusBar';

/** Что видят интеграционные тесты. Только в режиме тестов: журнал не отдаём другим расширениям. */
export interface TestApi {
  journal: Journal;
  journalView: JournalView;
}

let journal: Journal | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<TestApi | undefined> {
  const log = vscode.window.createOutputChannel('Adviser', { log: true });
  journal = await Journal.open(context, log);
  const settings = await ProjectSettings.create(log);
  const findings = new Findings(journal);
  const opened = journal;
  const reviewer = new Reviewer(
    context,
    log,
    () => learnerProfile(opened.all(), Date.now()),
    settings,
  );
  const status = new StatusBar(context, settings);
  const autopilot = new Autopilot(context, reviewer, findings, status, log, settings);
  // Названия типов ошибок для панели и отчёта. Без них панель покажет id.
  const patterns = await readPatterns(context).catch((e: unknown) => {
    log.warn(`patterns.json не прочитан: ${String(e)}`);
    return [];
  });
  const journalView = new JournalView(journal, patterns);
  context.subscriptions.push(
    log,
    journal,
    settings,
    findings,
    status,
    autopilot,
    journalView,
    vscode.window.createTreeView('adviser.journal', { treeDataProvider: journalView }),
    vscode.commands.registerCommand(REPORT_COMMAND, () =>
      showWeeklyReport(context, opened, patterns),
    ),
    vscode.commands.registerCommand('adviser.reviewFunction', () =>
      reviewFunction(reviewer, findings, status, log, (doc, code) =>
        autopilot.reviewedByCommand(doc, code),
      ),
    ),
    vscode.commands.registerCommand('adviser.setApiKey', () => setApiKey(context)),
    vscode.commands.registerCommand(MENU_COMMAND, () =>
      showMenu(context, autopilot, log, settings),
    ),
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
  return context.extensionMode === vscode.ExtensionMode.Test ? { journal, journalView } : undefined;
}

/** Журнал пишется с задержкой — дописываем то, что не успело уйти на диск. */
export function deactivate() {
  return journal?.flush();
}
