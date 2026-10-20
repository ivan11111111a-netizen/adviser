import * as vscode from 'vscode';
import { diagnosticText, hoverView, shortQuote, type Step } from '../core/disclosure';
import { REMIND_FROM, repeatsOf } from '../core/journal';
import { plural } from '../core/plural';
import type { Findings } from './findings';
import type { Journal } from './journal';

export const REVEAL_COMMAND = 'adviser.reveal';
export const OPEN_CASE_COMMAND = 'adviser.openCase';

export interface RevealArgs {
  id: string;
  step: Step;
}

export interface CaseArgs {
  file: string;
  line: number;
}

const LABEL: Record<Exclude<Step, 1>, string> = { 2: 'Объяснить', 3: 'Показать решение' };

const link = (label: string, command: string, args: unknown) =>
  `[${label}](command:${command}?${encodeURIComponent(JSON.stringify([args]))})`;

/**
 * Hover дополняет подчёркивание: первую ступень VS Code показывает сам (это текст диагностики),
 * здесь — открытые после неё ступени, кнопки следующих и напоминание о повторах.
 */
export function hoverProvider(findings: Findings, journal: Journal): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const here = findings.at(document.uri, position);
      if (!here.length) {
        return undefined;
      }
      const sections = here.map((finding) => {
        const { issue, languageId } = finding;
        const view = hoverView(issue, finding.step, finding.presentation);
        const md = new vscode.MarkdownString();
        // Ссылки-команды работают только для своих команд: текст модели не запустит чужую.
        md.isTrusted = { enabledCommands: [REVEAL_COMMAND, OPEN_CASE_COMMAND] };
        if (here.length > 1) {
          // Подчёркивания пересекаются — подписываем, к какому из них относятся кнопки.
          md.appendMarkdown('_«');
          md.appendText(shortQuote(diagnosticText(issue, finding.presentation)));
          md.appendMarkdown('»_\n\n');
        }
        const entry = journal.get(finding.id);
        const repeats = entry ? repeatsOf(journal.all(), entry) : { count: 0 };
        if (repeats.count >= REMIND_FROM && repeats.last) {
          const { file, line } = repeats.last;
          md.appendMarkdown(
            `_Ты так уже делал ${repeats.count} ${plural(repeats.count, 'раз', 'раза', 'раз')} на этой неделе._ ` +
              `${link('Прошлый случай', OPEN_CASE_COMMAND, { file, line } satisfies CaseArgs)}\n\n`,
          );
        }
        if (view.explanation) {
          md.appendMarkdown(`**Почему.** ${view.explanation}\n\n`);
        }
        if (view.readMore) {
          md.appendMarkdown(`[Подробнее](${view.readMore})\n\n`);
        }
        if (view.fix) {
          md.appendMarkdown(`**Решение.** ${view.fix.description}\n`);
          md.appendCodeblock(view.fix.code, languageId);
        }
        const buttons = view.actions.map((step) =>
          link(LABEL[step], REVEAL_COMMAND, { id: finding.id, step } satisfies RevealArgs),
        );
        if (buttons.length) {
          md.appendMarkdown(`**Adviser:** ${buttons.join(' · ')}`);
        }
        return md;
      });
      return new vscode.Hover(sections);
    },
  };
}

/** Ссылка «Прошлый случай» в hover: файл на той строке, где была ошибка. */
export async function openCase(log: vscode.LogOutputChannel, args?: CaseArgs) {
  if (!args) {
    return;
  }
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(args.file));
  } catch (e) {
    // Файл удалили или переименовали, а несохранённый Untitled закрыли.
    log.info(`прошлый случай не открыт: ${String(e)}`);
    vscode.window.setStatusBarMessage('Adviser: файла с прошлым случаем больше нет', 6000);
    return;
  }
  const line = Math.min(args.line, doc.lineCount - 1);
  await vscode.window.showTextDocument(doc, { selection: new vscode.Range(line, 0, line, 0) });
}

/** Кнопка в hover: открыть ступень и показать hover заново — после клика он остаётся старым. */
export async function revealStep(
  findings: Findings,
  log: vscode.LogOutputChannel,
  args?: RevealArgs,
) {
  const finding = args && findings.reveal(args.id, args.step);
  if (!finding) {
    return;
  }
  log.info(`${finding.issue.patternId}: открыта ступень ${finding.step}`);
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.uri.toString() !== finding.uri.toString()) {
    return;
  }
  if (!finding.range.contains(editor.selection.active)) {
    editor.selection = new vscode.Selection(finding.range.start, finding.range.start);
  }
  // Открытый hover showHover не пересчитывает, поэтому сначала закрываем его.
  await vscode.commands.executeCommand('editor.action.hideHover');
  await vscode.commands.executeCommand('editor.action.showHover');
}
