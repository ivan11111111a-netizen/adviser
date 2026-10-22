import * as vscode from 'vscode';
import {
  countPatterns,
  daysAgo,
  MASTERED_AFTER,
  masteredPatterns,
  renderReport,
  weeklyReport,
  type JournalEntry,
} from '../core/journal';
import type { Pattern } from '../core/patterns';
import { pluralForm } from '../core/i18n';
import { patternTitle, translate, uiLanguage } from './bundled';
import { OPEN_CASE_COMMAND, type CaseArgs } from './hover';
import type { Journal } from './journal';
import { currentLevel } from './mode';

export const REPORT_COMMAND = 'adviser.weeklyReport';
/** Сколько последних случаев показывать под типом ошибки. */
const CASES_SHOWN = 10;

type Group = 'frequent' | 'mastered';
type Node =
  | { kind: 'week' }
  | { kind: 'group'; group: Group }
  | { kind: 'pattern'; patternId: string; count: number }
  | { kind: 'case'; entry: JournalEntry };

function groupText(group: Group): { label: string; icon: string; tooltip: string } {
  return group === 'frequent'
    ? {
        label: vscode.l10n.t('Frequent mistakes in three weeks'),
        icon: 'flame',
        tooltip: vscode.l10n.t('Mistake types from the last three weeks, the most frequent first'),
      }
    : {
        label: vscode.l10n.t('Mastered'),
        icon: 'pass',
        tooltip: vscode.l10n.t('Happened at least twice and have not come back for three weeks'),
      };
}

function ago(at: number, now: number) {
  const days = daysAgo(at, now);
  if (days === 0) {
    return vscode.l10n.t('today');
  }
  return days === 1
    ? vscode.l10n.t('yesterday')
    : vscode.l10n.t('{0} {1} ago', days, pluralForm(days, vscode.l10n.t('day|days')));
}

/** Боковая панель «Журнал ошибок» (6.6 плана): неделя, частые ошибки с их случаями, освоенное. */
export class JournalView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly journal: Journal,
    private readonly patterns: Pattern[],
  ) {
    this.subscription = journal.onDidChange(() => this.emitter.fire());
  }

  getChildren(node?: Node): Node[] {
    const entries = this.journal.all();
    const now = Date.now();
    if (!node) {
      // Пустой журнал — VS Code покажет приветствие из viewsWelcome.
      return entries.length
        ? [
            { kind: 'week' },
            { kind: 'group', group: 'frequent' },
            { kind: 'group', group: 'mastered' },
          ]
        : [];
    }
    switch (node.kind) {
      case 'group':
        return this.patternsOf(node.group, now).map((p) => ({
          kind: 'pattern',
          patternId: p.patternId,
          count: p.count,
        }));
      case 'pattern':
        return entries
          .filter((e) => e.patternId === node.patternId)
          .sort((a, b) => b.at - a.at)
          .slice(0, CASES_SHOWN)
          .map((entry) => ({ kind: 'case', entry }));
      default:
        return [];
    }
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const now = Date.now();
    switch (node.kind) {
      case 'week': {
        const report = weeklyReport(this.journal.all(), now);
        const item = new vscode.TreeItem(
          vscode.l10n.t(
            'Week: {0} {1}',
            report.total,
            pluralForm(report.total, vscode.l10n.t('issue|issues')),
          ),
        );
        item.description = report.resolved
          ? vscode.l10n.t('fixed {0} of {1} on your own', report.selfSolved, report.resolved)
          : undefined;
        item.tooltip = vscode.l10n.t('Open the weekly report');
        item.iconPath = new vscode.ThemeIcon('calendar');
        item.command = { command: REPORT_COMMAND, title: vscode.l10n.t('Weekly Report') };
        return item;
      }
      case 'group': {
        const { label, icon, tooltip } = groupText(node.group);
        const count = this.patternsOf(node.group, now).length;
        const item = new vscode.TreeItem(
          label,
          !count
            ? vscode.TreeItemCollapsibleState.None
            : node.group === 'frequent'
              ? vscode.TreeItemCollapsibleState.Expanded
              : vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = count ? undefined : vscode.l10n.t('none yet');
        item.tooltip = tooltip;
        item.iconPath = new vscode.ThemeIcon(icon);
        return item;
      }
      case 'pattern': {
        const title = patternTitle(this.patterns, node.patternId);
        // Число — в начале: длинное название панель обрезает, и число в конце пропадало.
        const item = new vscode.TreeItem(
          `${node.count} · ${title}`,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.tooltip = `${title}\n${node.patternId}`;
        return item;
      }
      case 'case': {
        const { entry } = node;
        const name = vscode.Uri.parse(entry.file).path.split('/').pop();
        const item = new vscode.TreeItem(`${name}:${entry.line + 1}`);
        item.description = [
          ago(entry.at, now),
          entry.resolvedAt === undefined
            ? undefined
            : entry.step < 3
              ? vscode.l10n.t('fixed on your own')
              : vscode.l10n.t('fixed'),
        ]
          .filter(Boolean)
          .join(' · ');
        item.tooltip = entry.text;
        item.iconPath = new vscode.ThemeIcon(
          entry.resolvedAt === undefined ? 'circle-large-outline' : 'pass',
        );
        const args: CaseArgs = { file: entry.file, line: entry.line };
        item.command = {
          command: OPEN_CASE_COMMAND,
          title: vscode.l10n.t('Open'),
          arguments: [args],
        };
        return item;
      }
    }
  }

  dispose() {
    this.subscription.dispose();
    this.emitter.dispose();
  }

  private patternsOf(group: Group, now: number) {
    const entries = this.journal.all();
    return group === 'frequent'
      ? countPatterns(entries, now - MASTERED_AFTER, now + 1)
      : masteredPatterns(entries, now);
  }
}

/** Недельный отчёт: Markdown в globalStorageUri, открывается предпросмотром. */
export async function showWeeklyReport(
  context: vscode.ExtensionContext,
  journal: Journal,
  patterns: Pattern[],
) {
  const text = renderReport(weeklyReport(journal.all(), Date.now()), {
    title: (id) => patternTitle(patterns, id),
    // Даты — на языке интерфейса, как и текст: иначе выйдет «неделя с October 13».
    day: (time) =>
      new Date(time).toLocaleDateString(uiLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
        day: 'numeric',
        month: 'long',
      }),
    level: currentLevel(),
    t: translate,
  });
  const file = vscode.Uri.joinPath(context.globalStorageUri, 'report.md');
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(text));
  await vscode.commands.executeCommand('markdown.showPreview', file);
}
