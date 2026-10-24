import * as vscode from 'vscode';
import { pickRange, type LineRange } from '../core/codeRange';
import type { Findings } from './findings';
import { showReview, type Reviewer } from './reviewer';
import type { StatusBar } from './statusBar';
import { documentSymbols } from './symbols';

/**
 * «Adviser: Разобрать эту функцию» — функция под курсором или выделение. Работает в любом режиме
 * и при «Не беспокоить»: человек сам попросил. Ошибки без всплывающих окон.
 */
export async function reviewFunction(
  reviewer: Reviewer,
  findings: Findings,
  status: StatusBar,
  log: vscode.LogOutputChannel,
  onReviewed: (doc: vscode.TextDocument, code: string) => void,
) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    status.flash(vscode.l10n.t('open a code file'));
    return;
  }
  const doc = editor.document;
  const range = editor.selection.isEmpty
    ? pickRange(await documentSymbols(doc.uri), editor.selection.active.line, doc.lineCount)
    : selectedLines(editor.selection);
  const code = doc.getText(
    new vscode.Range(range.start, 0, range.end, doc.lineAt(range.end).text.length),
  );

  const outcome = await status.busy(reviewer.review(doc, range, 'command', undefined, true));
  switch (outcome.kind) {
    case 'reviewed': {
      const { issues } = outcome.review;
      showReview(findings, doc, range, issues, outcome.presentation);
      onReviewed(doc, code);
      status.flash(
        issues.length ? vscode.l10n.t('issues: {0}', issues.length) : vscode.l10n.t('no issues'),
      );
      return;
    }
    case 'refused':
      log.warn(outcome.message);
      status.flash(outcome.message);
      return;
    case 'failed':
      status.flash(vscode.l10n.t('the review failed, details in Output → Adviser'));
      return;
  }
}

/** Выделение до начала следующей строки эту строку не захватывает. */
function selectedLines(selection: vscode.Selection): LineRange {
  const end =
    selection.end.character === 0 && selection.end.line > selection.start.line
      ? selection.end.line - 1
      : selection.end.line;
  return { start: selection.start.line, end };
}
