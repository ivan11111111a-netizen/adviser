import * as vscode from 'vscode';
import { pickRange } from '../core/codeRange';
import { shortQuote } from '../core/disclosure';
import type { Findings } from './findings';
import { showHoverAgain, type CheckArgs } from './hover';
import type { Journal } from './journal';
import type { Reviewer } from './reviewer';
import type { StatusBar } from './statusBar';
import { documentSymbols } from './symbols';

/**
 * Ссылка «Проверь меня» в hover: человек своими словами объясняет ошибку, видя только намёк,
 * а модель говорит, верно ли. Верно — открывается объяснение, чтобы сверить, и случай в журнале
 * отмечается «объяснил сам». Нет — отзыв с новым вопросом, и можно ответить ещё раз.
 */
export async function checkYourself(
  reviewer: Reviewer,
  findings: Findings,
  journal: Journal,
  status: StatusBar,
  log: vscode.LogOutputChannel,
  args?: CheckArgs,
) {
  const finding = args && findings.byId(args.id);
  if (!finding || finding.hidden) {
    status.flash(vscode.l10n.t('the issue is outdated: review the function again'));
    return;
  }
  const answer =
    args.answer ??
    (await vscode.window.showInputBox({
      title: vscode.l10n.t('Adviser: check yourself'),
      prompt: vscode.l10n.t(
        "What is the mistake? Explain it in your own words, and Adviser will tell you if you're right.",
      ),
      placeHolder: shortQuote(finding.issue.hint, 80),
      ignoreFocusOut: true,
      validateInput: (v) =>
        v.trim() ? undefined : vscode.l10n.t('Write at least a couple of words'),
    }));
  if (!answer?.trim()) {
    return;
  }
  const doc = await vscode.workspace.openTextDocument(finding.uri);
  // Функция с замечанием, как при разборе. Строки замечания — от её начала.
  const found = pickRange(await documentSymbols(doc.uri), finding.range.start.line, doc.lineCount);
  const range = {
    start: Math.min(found.start, finding.range.start.line),
    end: Math.max(found.end, finding.range.end.line),
  };
  const issue = {
    ...finding.issue,
    startLine: finding.range.start.line - range.start + 1,
    endLine: finding.range.end.line - range.start + 1,
  };
  const outcome = await status.busy(reviewer.check(doc, range, issue, answer));
  switch (outcome.kind) {
    case 'refused':
      log.warn(outcome.message);
      status.flash(outcome.message);
      return;
    case 'failed':
      status.flash(vscode.l10n.t('could not check the answer, details in Output → Adviser'));
      return;
  }
  const { understood, feedback } = outcome;
  finding.check = { answer: answer.trim(), understood, feedback };
  if (understood) {
    journal.update(finding.id, { explained: true });
    // Объяснение — чтобы сверить со своим.
    findings.reveal(finding.id, 2);
  }
  if (!(await showHoverAgain(finding))) {
    void vscode.window.showInformationMessage(
      `Adviser: ${understood ? '✓' : vscode.l10n.t('not quite.')} ${feedback}`,
    );
  }
}
