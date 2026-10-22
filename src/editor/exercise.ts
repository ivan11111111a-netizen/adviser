import * as vscode from 'vscode';
import { exerciseChoices, exerciseLanguage, exerciseText } from '../core/exercise';
import { learnerProfile } from '../core/journal';
import type { Pattern } from '../core/patterns';
import { pluralForm } from '../core/i18n';
import { patternTitle } from './bundled';
import type { Findings } from './findings';
import type { Journal } from './journal';
import type { Reviewer } from './reviewer';
import type { StatusBar } from './statusBar';

export interface ExerciseArgs {
  /** Тип ошибки без выбора из списка: так команду зовут интеграционные тесты. */
  patternId?: string;
}

/**
 * «Adviser: Упражнение на частую ошибку»: выбрать тип ошибки (частые — сверху) и получить новую
 * функцию с такой ошибкой в безымянном файле. Разборы в нём в журнал не идут.
 */
export async function startExercise(
  reviewer: Reviewer,
  findings: Findings,
  journal: Journal,
  patterns: Pattern[],
  status: StatusBar,
  args?: ExerciseArgs,
) {
  const editor = vscode.window.activeTextEditor;
  const current = editor?.document.languageId;
  const pattern = args?.patternId
    ? patterns.find((p) => p.id === args.patternId)
    : await pickPattern(patterns, journal, current);
  if (!pattern) {
    return;
  }
  const languageId = exerciseLanguage(journal.all(), pattern, current);
  const outcome = await status.busy(reviewer.exercise(pattern, languageId, editor?.document.uri));
  switch (outcome.kind) {
    case 'refused':
      status.flash(outcome.message);
      return;
    case 'failed':
      status.flash(vscode.l10n.t('could not make up an exercise, details in Output → Adviser'));
      return;
  }
  const doc = await vscode.workspace.openTextDocument({
    language: languageId,
    content: exerciseText(outcome.exercise, pattern, languageId, outcome.language),
  });
  findings.markExercise(doc.uri);
  await vscode.window.showTextDocument(doc);
  status.flash(vscode.l10n.t('the exercise is ready: find the mistake'));
}

async function pickPattern(
  patterns: Pattern[],
  journal: Journal,
  current: string | undefined,
): Promise<Pattern | undefined> {
  const choices = exerciseChoices(
    patterns,
    learnerProfile(journal.all(), Date.now()),
    current ?? 'javascript',
  );
  type Item = vscode.QuickPickItem & { pattern?: Pattern };
  const items: Item[] = [];
  const top = choices.filter((c) => c.count);
  if (top.length) {
    items.push({
      label: vscode.l10n.t('Your frequent mistakes'),
      kind: vscode.QuickPickItemKind.Separator,
    });
    items.push(
      ...top.map((c) => ({
        label: patternTitle(patterns, c.pattern.id),
        description: vscode.l10n.t(
          '{0} {1} in three weeks',
          c.count!,
          pluralForm(c.count!, vscode.l10n.t('time|times')),
        ),
        pattern: c.pattern,
      })),
    );
    items.push({ label: vscode.l10n.t('Other'), kind: vscode.QuickPickItemKind.Separator });
  }
  items.push(
    ...choices
      .filter((c) => !c.count)
      .map((c) => ({ label: patternTitle(patterns, c.pattern.id), pattern: c.pattern })),
  );
  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Adviser: exercise'),
    placeHolder: vscode.l10n.t('Which mistake do you want to practice'),
    matchOnDescription: true,
    // Иначе страница «Начало работы» (webview) забирает фокус и закрывает список.
    ignoreFocusOut: true,
  });
  return picked?.pattern;
}
