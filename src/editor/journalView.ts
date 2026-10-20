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
import { plural } from '../core/plural';
import { patternTitle } from './bundled';
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

const GROUPS: Record<Group, { label: string; icon: string; tooltip: string }> = {
  frequent: {
    label: 'Частые ошибки за три недели',
    icon: 'flame',
    tooltip: 'Типы ошибок, которые встречались за последние три недели, — чаще выше',
  },
  mastered: {
    label: 'Освоено',
    icon: 'pass',
    tooltip: 'Встречались хотя бы дважды и не повторялись три недели',
  },
};

function ago(at: number, now: number) {
  const days = daysAgo(at, now);
  if (days === 0) {
    return 'сегодня';
  }
  return days === 1 ? 'вчера' : `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
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
          `Неделя: ${report.total} ${plural(report.total, 'замечание', 'замечания', 'замечаний')}`,
        );
        item.description = report.resolved
          ? `сам исправил ${report.selfSolved} из ${report.resolved}`
          : undefined;
        item.tooltip = 'Открыть недельный отчёт';
        item.iconPath = new vscode.ThemeIcon('calendar');
        item.command = { command: REPORT_COMMAND, title: 'Отчёт за неделю' };
        return item;
      }
      case 'group': {
        const { label, icon, tooltip } = GROUPS[node.group];
        const count = this.patternsOf(node.group, now).length;
        const item = new vscode.TreeItem(
          label,
          !count
            ? vscode.TreeItemCollapsibleState.None
            : node.group === 'frequent'
              ? vscode.TreeItemCollapsibleState.Expanded
              : vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = count ? undefined : 'пока нет';
        item.tooltip = tooltip;
        item.iconPath = new vscode.ThemeIcon(icon);
        return item;
      }
      case 'pattern': {
        const item = new vscode.TreeItem(
          patternTitle(this.patterns, node.patternId),
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = String(node.count);
        item.tooltip = node.patternId;
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
              ? 'исправил сам'
              : 'исправлено',
        ]
          .filter(Boolean)
          .join(' · ');
        item.tooltip = entry.text;
        item.iconPath = new vscode.ThemeIcon(
          entry.resolvedAt === undefined ? 'circle-large-outline' : 'pass',
        );
        const args: CaseArgs = { file: entry.file, line: entry.line };
        item.command = { command: OPEN_CASE_COMMAND, title: 'Открыть', arguments: [args] };
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
    // Интерфейс пока только русский, и даты тоже: иначе выйдет «неделя с October 13».
    day: (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
    level: currentLevel(),
  });
  const file = vscode.Uri.joinPath(context.globalStorageUri, 'report.md');
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(text));
  await vscode.commands.executeCommand('markdown.showPreview', file);
}
