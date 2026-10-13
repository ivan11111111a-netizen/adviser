import * as vscode from 'vscode';
import { diagnosticText, hoverView, shortQuote, type Step } from '../core/disclosure';
import type { Findings } from './findings';

export const REVEAL_COMMAND = 'adviser.reveal';

export interface RevealArgs {
  id: string;
  step: Step;
}

const LABEL: Record<Exclude<Step, 1>, string> = { 2: 'Объяснить', 3: 'Показать решение' };

/**
 * Hover дополняет подчёркивание: первую ступень VS Code показывает сам (это текст диагностики),
 * здесь — открытые после неё ступени и кнопки следующих.
 */
export function hoverProvider(findings: Findings): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const here = findings.at(document.uri, position);
      if (!here.length) {
        return undefined;
      }
      const sections = here.map((finding) => {
        const { issue, languageId } = finding;
        const view = hoverView(issue, finding.step);
        const md = new vscode.MarkdownString();
        // Ссылки-команды работают только для своей команды: текст модели не запустит чужую.
        md.isTrusted = { enabledCommands: [REVEAL_COMMAND] };
        if (here.length > 1) {
          // Подчёркивания пересекаются — подписываем, к какому из них относятся кнопки.
          md.appendMarkdown('_«');
          md.appendText(shortQuote(diagnosticText(issue)));
          md.appendMarkdown('»_\n\n');
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
        const buttons = view.actions.map((step) => {
          const args: RevealArgs = { id: finding.id, step };
          return `[${LABEL[step]}](command:${REVEAL_COMMAND}?${encodeURIComponent(JSON.stringify([args]))})`;
        });
        if (buttons.length) {
          md.appendMarkdown(`**Adviser:** ${buttons.join(' · ')}`);
        }
        return md;
      });
      return new vscode.Hover(sections);
    },
  };
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
