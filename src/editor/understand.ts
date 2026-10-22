import { relative } from 'node:path';
import * as vscode from 'vscode';
import {
  fitDiffs,
  MAX_QUESTIONS,
  newFileDiff,
  renderQuizReport,
  type FileDiff,
} from '../core/understand';
import { translate } from './bundled';
import { currentMode, doNotDisturbUntil } from './mode';
import type { Reviewer } from './reviewer';
import { ownerUri } from './settings';
import type { StatusBar } from './statusBar';

export const UNDERSTAND_COMMAND = 'adviser.understandChanges';

export interface UnderstandArgs {
  /** Ответы без окон ввода: так команду зовут интеграционные тесты. */
  answers?: string[];
}

/** Нужная часть API встроенного расширения Git (extensions/git/src/api/git.d.ts). */
interface GitChange {
  readonly uri: vscode.Uri;
  readonly status: number;
}
interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly indexChanges: GitChange[];
    readonly workingTreeChanges: GitChange[];
    readonly untrackedChanges?: GitChange[];
  };
  diffWithHEAD(path: string): Promise<string>;
}
interface GitApi {
  readonly repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

/** Status из git.d.ts: удалённые файлы пропускаем, новые (ещё не в git) берём целиком. */
const DELETED = new Set([2, 6]);
const UNTRACKED = new Set([7, 9]);

async function gitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
  if (!extension) {
    return undefined;
  }
  const exports = extension.isActive ? extension.exports : await extension.activate();
  return exports.getAPI(1);
}

async function repositoryFor(uri: vscode.Uri | undefined): Promise<GitRepository | undefined> {
  const git = await gitApi();
  if (!git) {
    return undefined;
  }
  return (uri && git.getRepository(ownerUri(uri))) ?? git.repositories[0];
}

/** Изменения относительно последнего коммита — только файлы, которые можно отправить. */
async function collectDiffs(
  repo: GitRepository,
  reviewer: Reviewer,
  log: vscode.LogOutputChannel,
): Promise<FileDiff[]> {
  const { indexChanges, workingTreeChanges, untrackedChanges = [] } = repo.state;
  const seen = new Set<string>();
  const files: FileDiff[] = [];
  for (const change of [...indexChanges, ...workingTreeChanges, ...untrackedChanges]) {
    const key = change.uri.toString();
    if (seen.has(key) || DELETED.has(change.status)) {
      continue;
    }
    seen.add(key);
    const path = relative(repo.rootUri.fsPath, change.uri.fsPath).replaceAll('\\', '/');
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(change.uri);
    } catch {
      // Двоичный файл или папка: вопросов по ним не будет.
      continue;
    }
    if (!reviewer.sendable(doc)) {
      log.info(`${path}: не отправляется (.env, ignore), в вопросы не вошёл`);
      continue;
    }
    const diff = UNTRACKED.has(change.status)
      ? newFileDiff(doc.getText())
      : await repo.diffWithHEAD(change.uri.fsPath);
    files.push({ path, diff });
  }
  return files;
}

/**
 * «Adviser: Понимаю ли я изменения»: вопросы по изменениям относительно последнего коммита —
 * например, по коду, который написал ИИ-агент. Ответы по одному, в конце — отчёт.
 */
export async function understandChanges(
  context: vscode.ExtensionContext,
  reviewer: Reviewer,
  status: StatusBar,
  log: vscode.LogOutputChannel,
  args?: UnderstandArgs,
) {
  const repo = await repositoryFor(vscode.window.activeTextEditor?.document.uri);
  if (!repo) {
    status.flash(
      vscode.l10n.t('the folder is not in git: Adviser compares changes with the last commit'),
    );
    return;
  }
  const fitted = fitDiffs(await collectDiffs(repo, reviewer, log));
  if (!fitted.included.length) {
    status.flash(vscode.l10n.t('no changes: everything is as in the last commit'));
    return;
  }
  const asked = await status.busy(reviewer.quizQuestions(fitted.text, repo.rootUri));
  if (asked.kind !== 'done') {
    status.flash(
      asked.kind === 'refused' ? asked.message : vscode.l10n.t('could not make up questions'),
    );
    return;
  }
  const quiz = { ...asked.data, questions: asked.data.questions.slice(0, MAX_QUESTIONS) };
  if (!quiz.questions.length) {
    status.flash(vscode.l10n.t('no questions: the changes are too small'));
    return;
  }
  const answers = args?.answers ?? [];
  if (!args?.answers) {
    for (const [i, q] of quiz.questions.entries()) {
      const answer = await vscode.window.showInputBox({
        title: vscode.l10n.t(
          'Adviser: question {0} of {1} · {2}',
          i + 1,
          quiz.questions.length,
          q.file,
        ),
        prompt: q.question,
        placeHolder: vscode.l10n.t('Answer in your own words. Empty to skip'),
        ignoreFocusOut: true,
      });
      if (answer === undefined) {
        // Esc — передумал: без оценки и отчёта.
        return;
      }
      answers.push(answer);
    }
  }
  const checked = await status.busy(reviewer.quizAnswers(fitted.text, quiz, answers, repo.rootUri));
  if (checked.kind !== 'done') {
    status.flash(
      checked.kind === 'refused' ? checked.message : vscode.l10n.t('could not check the answers'),
    );
    return;
  }
  const right = checked.data.filter((r) => r.understood).length;
  log.info(`понимание изменений: верно ${right} из ${quiz.questions.length}`);
  const file = vscode.Uri.joinPath(context.globalStorageUri, 'changes.md');
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  await vscode.workspace.fs.writeFile(
    file,
    new TextEncoder().encode(renderQuizReport(quiz, answers, checked.data, fitted, translate)),
  );
  await vscode.commands.executeCommand('markdown.showPreview', file);
}

/** Предлагать проверить себя не чаще раза в полчаса: агенты правят файлы пачками. */
const SUGGEST_EVERY_MS = 30 * 60_000;
let suggestedAt = 0;

/**
 * Файл изменился извне на много строк — похоже, его переписал ИИ-агент. Если в нём есть
 * изменения относительно коммита (а не просто git checkout), предлагаем проверить себя.
 * Не в «Вручную» и не при «Не беспокоить».
 */
export async function suggestUnderstand(
  context: vscode.ExtensionContext,
  reviewer: Reviewer,
  doc: vscode.TextDocument,
) {
  const now = Date.now();
  if (
    now - suggestedAt < SUGGEST_EVERY_MS ||
    currentMode() === 'manual' ||
    (doNotDisturbUntil(context) ?? 0) > now ||
    !reviewer.sendable(doc)
  ) {
    return;
  }
  const repo = await repositoryFor(doc.uri);
  if (!repo || !(await repo.diffWithHEAD(doc.uri.fsPath).catch(() => '')).trim()) {
    return;
  }
  suggestedAt = now;
  const check = vscode.l10n.t('Check myself');
  const name = vscode.workspace.asRelativePath(doc.uri, false);
  const answer = await vscode.window.showInformationMessage(
    vscode.l10n.t(
      'Adviser: "{0}" changed a lot from outside — for example, an AI agent rewrote it. Check whether you understand the changes?',
      name,
    ),
    check,
  );
  if (answer === check) {
    await vscode.commands.executeCommand(UNDERSTAND_COMMAND);
  }
}
