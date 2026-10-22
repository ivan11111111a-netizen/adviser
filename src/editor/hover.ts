import * as vscode from 'vscode';
import { diagnosticText, hoverView, shortQuote, type Step } from '../core/disclosure';
import { REMIND_FROM, repeatsOf, solutionDelayActive, solutionWait } from '../core/journal';
import { pluralForm } from '../core/i18n';
import type { Finding, Findings } from './findings';
import type { Journal } from './journal';
import { NOTEBOOK_CELL_SCHEME, ownerUri } from './settings';

export const REVEAL_COMMAND = 'adviser.reveal';
export const OPEN_CASE_COMMAND = 'adviser.openCase';
export const CHECK_COMMAND = 'adviser.check';

export interface CheckArgs {
  id: string;
  /** Ответ без окна ввода: так его передают интеграционные тесты. */
  answer?: string;
}

export interface RevealArgs {
  id: string;
  step: Step;
}

export interface CaseArgs {
  file: string;
  line: number;
}

const label = (step: Exclude<Step, 1>) =>
  step === 2 ? vscode.l10n.t('Explain') : vscode.l10n.t('Show solution');

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
        md.isTrusted = { enabledCommands: [REVEAL_COMMAND, OPEN_CASE_COMMAND, CHECK_COMMAND] };
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
          const times = pluralForm(repeats.count, vscode.l10n.t('time|times'));
          md.appendMarkdown(
            `${vscode.l10n.t('_You have made this mistake {0} {1} this week._', repeats.count, times)} ` +
              `${link(vscode.l10n.t('Previous case'), OPEN_CASE_COMMAND, { file, line } satisfies CaseArgs)}\n\n`,
          );
        }
        if (finding.check) {
          const { answer, understood, feedback } = finding.check;
          md.appendMarkdown(`${vscode.l10n.t('**Your answer:**')} _`);
          md.appendText(shortQuote(answer, 200));
          // Отзыв модели обычно сам начинается с «Верно», поэтому у верного ответа — только значок.
          md.appendMarkdown(
            `_\n\n${understood ? '✓' : vscode.l10n.t('**Not quite.**')} ${feedback}\n\n`,
          );
        }
        if (view.explanation) {
          md.appendMarkdown(`${vscode.l10n.t('**Why.**')} ${view.explanation}\n\n`);
        }
        if (view.example) {
          md.appendMarkdown(`${vscode.l10n.t('**Example.**')}\n`);
          md.appendCodeblock(view.example, languageId);
        }
        if (view.readMore) {
          md.appendMarkdown(`[${vscode.l10n.t('Read more')}](${view.readMore})\n\n`);
        }
        if (view.fix) {
          md.appendMarkdown(`${vscode.l10n.t('**Solution.**')} ${view.fix.description}\n`);
          md.appendCodeblock(view.fix.code, languageId);
        }
        const wait = solutionWaitFor(journal, finding);
        const buttons = view.actions.map((step) =>
          step === 3 && wait > 0
            ? vscode.l10n.t('_solution in {0} s: try it yourself first_', Math.ceil(wait / 1000))
            : link(label(step), REVEAL_COMMAND, { id: finding.id, step } satisfies RevealArgs),
        );
        // Объяснить самому можно, пока видишь только намёк.
        if (view.actions.includes(2)) {
          buttons.unshift(
            link(
              finding.check ? vscode.l10n.t('Answer again') : vscode.l10n.t('Check me'),
              CHECK_COMMAND,
              {
                id: finding.id,
              } satisfies CheckArgs,
            ),
          );
        }
        if (buttons.length) {
          md.appendMarkdown(`**Adviser:** ${buttons.join(' · ')}`);
        }
        return md;
      });
      return new vscode.Hover(sections);
    },
  };
}

/**
 * Сколько ещё ждать «Показать решение» (вопрос 2 раздела 16 плана): adviser.solutionDelay и журнал
 * решают, включена ли пауза. Ревьюеру — без паузы.
 */
function solutionWaitFor(journal: Journal, finding: Finding): number {
  const entry = journal.get(finding.id);
  if (!entry || finding.presentation === 'reviewer') {
    return 0;
  }
  const setting = vscode.workspace
    .getConfiguration('adviser', finding.uri)
    .get<string>('solutionDelay', 'auto');
  const now = Date.now();
  return solutionDelayActive(journal.all(), now, setting) ? solutionWait(entry, now) : 0;
}

/** Ссылка «Прошлый случай» в hover: файл на той строке, где была ошибка. */
export async function openCase(log: vscode.LogOutputChannel, args?: CaseArgs) {
  if (!args) {
    return;
  }
  const uri = vscode.Uri.parse(args.file);
  if (uri.scheme === NOTEBOOK_CELL_SCHEME) {
    // Ячейку отдельно не открыть — открываем её ноутбук.
    await vscode.commands.executeCommand('vscode.open', ownerUri(uri));
    return;
  }
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch (e) {
    // Файл удалили или переименовали, а несохранённый Untitled закрыли.
    log.info(`прошлый случай не открыт: ${String(e)}`);
    vscode.window.setStatusBarMessage(
      vscode.l10n.t('Adviser: the file with the previous case is gone'),
      6000,
    );
    return;
  }
  const line = Math.min(args.line, doc.lineCount - 1);
  await vscode.window.showTextDocument(doc, { selection: new vscode.Range(line, 0, line, 0) });
}

/** Кнопка в hover: открыть ступень и показать hover заново — после клика он остаётся старым. */
export async function revealStep(
  findings: Findings,
  journal: Journal,
  log: vscode.LogOutputChannel,
  args?: RevealArgs,
) {
  const before = args && findings.byId(args.id);
  const wait = before ? solutionWaitFor(journal, before) : 0;
  if (args?.step === 3 && wait > 0) {
    // Ссылка из старой подсказки: пауза ещё не прошла.
    vscode.window.setStatusBarMessage(
      vscode.l10n.t('Adviser: solution in {0} s, try it yourself first', Math.ceil(wait / 1000)),
      6000,
    );
    return;
  }
  const finding = args && findings.reveal(args.id, args.step);
  if (!finding) {
    return;
  }
  log.info(`${finding.issue.patternId}: открыта ступень ${finding.step}`);
  await showHoverAgain(finding);
}

/**
 * Показать hover замечания заново — после клика он остаётся старым. false — файл замечания
 * не в активном редакторе.
 */
export async function showHoverAgain(finding: Finding): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.uri.toString() !== finding.uri.toString()) {
    return false;
  }
  if (!finding.range.contains(editor.selection.active)) {
    editor.selection = new vscode.Selection(finding.range.start, finding.range.start);
  }
  // Открытый hover showHover не пересчитывает, поэтому сначала закрываем его.
  await vscode.commands.executeCommand('editor.action.hideHover');
  await vscode.commands.executeCommand('editor.action.showHover');
  return true;
}
