import * as vscode from 'vscode';
import { setApiKey } from './config/provider';
import type { ModelRequest } from './core/engine';
import { learnerProfile } from './core/journal';
import { Autopilot } from './editor/autopilot';
import { Consent } from './editor/consent';
import {
  Feedback,
  FEEDBACK_COMMAND,
  feedbackActions,
  HIDE_PATTERN_COMMAND,
  type FeedbackArgs,
  type HidePatternArgs,
} from './editor/feedback';
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
import { clearJournal, exportJournal, Journal } from './editor/journal';
import { JournalView, REPORT_COMMAND, showWeeklyReport } from './editor/journalView';
import { reviewFunction } from './editor/reviewCommand';
import { Reviewer } from './editor/reviewer';
import { ProjectSettings } from './editor/settings';
import {
  chooseLevel,
  openWalkthrough,
  setupOllama,
  setupOpenRouter,
  setupOwnKey,
  tryReview,
  welcome,
} from './editor/setup';
import { MENU_COMMAND, showMenu, StatusBar } from './editor/statusBar';
import { UsageTracker } from './editor/usage';
import { lastMockRequest } from './providers/mock';

/** Что видят интеграционные тесты. Только в режиме тестов: журнал не отдаём другим расширениям. */
export interface TestApi {
  journal: Journal;
  journalView: JournalView;
  /** Что ушло бы модели в последнем разборе через mock. */
  lastMockRequest: () => ModelRequest | undefined;
}

let journal: Journal | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<TestApi | undefined> {
  const log = vscode.window.createOutputChannel('Adviser', { log: true });
  journal = await Journal.open(context, log);
  const settings = await ProjectSettings.create(log);
  const usage = new UsageTracker(context);
  const consent = new Consent(context);
  const findings = new Findings(journal);
  const opened = journal;
  const reviewer = new Reviewer(
    context,
    log,
    () => learnerProfile(opened.all(), Date.now()),
    settings,
    usage,
    consent,
  );
  const status = new StatusBar(context, settings, usage);
  const autopilot = new Autopilot(context, reviewer, findings, status, log, settings);
  // Названия типов ошибок для панели и отчёта. Без них панель покажет id.
  const patterns = await readPatterns(context).catch((e: unknown) => {
    log.warn(`patterns.json не прочитан: ${String(e)}`);
    return [];
  });
  const journalView = new JournalView(journal, patterns);
  const feedback = new Feedback(findings, journal, patterns, status, log);
  context.subscriptions.push(
    log,
    journal,
    settings,
    usage,
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
    vscode.commands.registerCommand('adviser.revokeConsent', () => consent.revoke()),
    vscode.commands.registerCommand('adviser.exportJournal', () => exportJournal(opened)),
    vscode.commands.registerCommand('adviser.clearJournal', () => clearJournal(opened)),
    vscode.commands.registerCommand('adviser.openWalkthrough', () => openWalkthrough(context)),
    vscode.commands.registerCommand('adviser.setupOpenRouter', () => setupOpenRouter(context)),
    vscode.commands.registerCommand('adviser.setupOllama', () => setupOllama()),
    vscode.commands.registerCommand('adviser.setupOwnKey', () => setupOwnKey(context)),
    vscode.commands.registerCommand('adviser.chooseLevel', () => chooseLevel()),
    vscode.commands.registerCommand('adviser.tryReview', () => tryReview(context)),
    vscode.commands.registerCommand(MENU_COMMAND, () =>
      showMenu(context, autopilot, log, settings),
    ),
    // Не объявлены в package.json, поэтому их нет в палитре: их зовут только ссылки в hover.
    vscode.commands.registerCommand(REVEAL_COMMAND, (args?: RevealArgs) =>
      revealStep(findings, opened, log, args),
    ),
    vscode.commands.registerCommand(OPEN_CASE_COMMAND, (args?: CaseArgs) => openCase(log, args)),
    vscode.commands.registerCommand(FEEDBACK_COMMAND, (args?: FeedbackArgs) =>
      feedback.answer(args),
    ),
    vscode.commands.registerCommand(HIDE_PATTERN_COMMAND, (args?: HidePatternArgs) =>
      feedback.hidePattern(args),
    ),
    vscode.languages.registerCodeActionsProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }],
      feedbackActions(findings, patterns),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
    vscode.languages.registerHoverProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }],
      hoverProvider(findings, journal),
    ),
  );
  void welcome(context);
  return context.extensionMode === vscode.ExtensionMode.Test
    ? { journal, journalView, lastMockRequest: () => lastMockRequest }
    : undefined;
}

/** Журнал пишется с задержкой — дописываем то, что не успело уйти на диск. */
export function deactivate() {
  return journal?.flush();
}
