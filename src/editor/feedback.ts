import * as vscode from 'vscode';
import { reindent } from '../core/applyFix';
import { diagnosticText, shortQuote } from '../core/disclosure';
import { disagreements, OFFER_HIDE_AFTER } from '../core/journal';
import type { Pattern } from '../core/patterns';
import type { Issue } from '../core/reviewSchema';
import { plural } from '../core/plural';
import { patternTitle } from './bundled';
import type { Findings } from './findings';
import type { Journal } from './journal';
import type { StatusBar } from './statusBar';

export const FEEDBACK_COMMAND = 'adviser.feedback';
export const HIDE_PATTERN_COMMAND = 'adviser.hidePattern';

export interface FeedbackArgs {
  id: string;
  kind: 'understood' | 'disagree';
}

export interface HidePatternArgs {
  patternId: string;
}

/** Лампочка у замечания (6.8, 6.11 плана): «понял», «не согласен», «больше не показывать». */
export function feedbackActions(
  findings: Findings,
  patterns: Pattern[],
): vscode.CodeActionProvider {
  return {
    provideCodeActions(document, range, context) {
      const here = findings.in(document.uri, range);
      return here.flatMap((finding) => {
        const { issue } = finding;
        // Несколько замечаний в одном месте — подписываем, к какому относится действие.
        const quote =
          here.length > 1
            ? ` («${shortQuote(diagnosticText(issue, finding.presentation), 40)}»)`
            : '';
        const diagnostics = context.diagnostics.filter(
          (d) => d.source === 'Adviser' && d.code === issue.patternId,
        );
        const action = (title: string, command: string, args: FeedbackArgs | HidePatternArgs) => {
          const a = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
          a.command = { command, title, arguments: [args] };
          a.diagnostics = diagnostics;
          return a;
        };
        // Применить можно только уже показанное решение: лампочка не должна обходить ступени.
        const apply = finding.step >= 3 ? [applyFix(document, finding.range, issue, quote)] : [];
        return [
          ...apply,
          action(`Adviser: понял${quote}`, FEEDBACK_COMMAND, {
            id: finding.id,
            kind: 'understood',
          }),
          action(`Adviser: не согласен${quote}`, FEEDBACK_COMMAND, {
            id: finding.id,
            kind: 'disagree',
          }),
          action(
            `Adviser: больше не показывать «${patternTitle(patterns, issue.patternId)}»`,
            HIDE_PATTERN_COMMAND,
            { patternId: issue.patternId },
          ),
        ];
      });
    },
  };
}

/**
 * «Применить решение»: код из fix вместо строк замечания. Правка помечена needsConfirmation —
 * VS Code сначала показывает предпросмотр (6.10 плана: советы применяются только по клику и с превью).
 */
function applyFix(
  document: vscode.TextDocument,
  range: vscode.Range,
  issue: Issue,
  quote: string,
): vscode.CodeAction {
  const title = `Adviser: применить решение${quote}`;
  const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
  const lines = new vscode.Range(
    range.start.line,
    0,
    range.end.line,
    document.lineAt(range.end.line).text.length,
  );
  const indent = /^[ \t]*/.exec(document.lineAt(range.start.line).text)![0];
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, lines, reindent(issue.fix.code, indent), {
    needsConfirmation: true,
    label: issue.fix.description,
  });
  action.edit = edit;
  return action;
}

export class Feedback {
  constructor(
    private readonly findings: Findings,
    private readonly journal: Journal,
    private readonly patterns: Pattern[],
    private readonly status: StatusBar,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  /** «Понял» и «не согласен» прячут замечание; несогласие несколько раз — повод скрыть тип. */
  async answer(args?: FeedbackArgs) {
    const finding = args && this.findings.hide(args.id);
    if (!finding) {
      return;
    }
    const { patternId } = finding.issue;
    this.journal.update(finding.id, { feedback: args.kind });
    this.log.info(`${patternId}: ${args.kind === 'understood' ? 'понял' : 'не согласен'}`);
    if (args.kind !== 'disagree') {
      return;
    }
    const n = disagreements(this.journal.all(), patternId);
    if (n < OFFER_HIDE_AFTER || n % OFFER_HIDE_AFTER !== 0) {
      return;
    }
    const title = patternTitle(this.patterns, patternId);
    const answer = await vscode.window.showInformationMessage(
      `Ты уже ${n} ${plural(n, 'раз', 'раза', 'раз')} не согласен с замечаниями «${title}». Больше их не показывать?`,
      'Не показывать',
      'Оставить',
    );
    if (answer === 'Не показывать') {
      await this.hidePattern({ patternId });
    }
  }

  /** Тип ошибки — в adviser.hiddenPatterns: там его можно и вернуть. */
  async hidePattern(args?: HidePatternArgs) {
    if (!args) {
      return;
    }
    const config = vscode.workspace.getConfiguration('adviser');
    const hidden = config.get<string[]>('hiddenPatterns', []);
    if (!hidden.includes(args.patternId)) {
      await config.update(
        'hiddenPatterns',
        [...hidden, args.patternId],
        vscode.ConfigurationTarget.Global,
      );
    }
    this.findings.hidePattern(args.patternId);
    this.log.info(`${args.patternId}: больше не показывать`);
    this.status.flash(
      `больше не покажу «${patternTitle(this.patterns, args.patternId)}». Вернуть — настройка adviser.hiddenPatterns`,
    );
  }
}
