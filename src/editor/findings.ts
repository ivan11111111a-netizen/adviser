import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { LineRange } from '../core/codeRange';
import { diagnosticText, firstStep, reveal, type Step } from '../core/disclosure';
import { trackRange } from '../core/changes';
import { matchByPattern, openCasesIn } from '../core/journal';
import type { Issue, Severity } from '../core/reviewSchema';
import { lineEdits } from './edits';
import type { Journal } from './journal';

export interface NewFinding {
  range: vscode.Range;
  issue: Issue;
  languageId: string;
}

export interface Finding extends NewFinding {
  /** Он же id случая в журнале. По нему кнопки в hover находят замечание. */
  id: string;
  uri: vscode.Uri;
  step: Step;
  /**
   * Скрыто: код правили после разбора (6.8 плана) или человек ответил на совет.
   * Скрытое ждёт нового разбора, чтобы случай в журнале продолжился или закрылся.
   */
  hidden?: boolean;
}

// Error не используем никогда: его легко спутать с ошибкой компилятора.
const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Warning,
  warning: vscode.DiagnosticSeverity.Information,
  suggestion: vscode.DiagnosticSeverity.Hint,
};

/** Замечания по файлам: подчёркивания в редакторе, открытые ступени и данные для hover. */
export class Findings implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('adviser');
  private readonly byUri = new Map<string, Finding[]>();
  private readonly subscription = vscode.workspace.onDidChangeTextDocument((e) => this.edited(e));

  constructor(private readonly journal: Journal) {}

  /**
   * Заменяет замечания в разобранном диапазоне, замечания по другим функциям файла остаются.
   * Тот же тип ошибки в том же диапазоне — тот же случай: сохраняет id и открытую ступень.
   * Прежние замечания, которых в новом разборе нет, журнал считает исправленными.
   */
  replace(uri: vscode.Uri, reviewed: LineRange, findings: NewFinding[]) {
    const all = this.byUri.get(uri.toString()) ?? [];
    const outside = (f: Finding) =>
      f.range.end.line < reviewed.start || f.range.start.line > reviewed.end;
    // Случаи из журнала — только для файлов на диске: Untitled-1 в каждой сессии новый.
    const fromJournal =
      uri.scheme === 'file'
        ? openCasesIn(this.journal.all(), uri.toString(), reviewed, new Set(all.map((f) => f.id)))
        : [];
    const previous: { id: string; step: Step; patternId: string }[] = [
      ...all.filter((f) => !outside(f)).map((f) => ({ ...f, patternId: f.issue.patternId })),
      ...fromJournal,
    ];
    const { matched, resolved } = matchByPattern(
      previous,
      findings.map((f) => f.issue.patternId),
      (p) => p.patternId,
    );
    const now = Date.now();
    const added = findings.map((f, i): Finding => {
      const before = matched[i];
      const step = reveal(before?.step ?? 1, firstStep(f.issue.severity));
      const finding = { ...f, uri, id: before?.id ?? randomUUID(), step };
      if (!before) {
        this.journal.record({
          id: finding.id,
          patternId: f.issue.patternId,
          severity: f.issue.severity,
          languageId: f.languageId,
          file: uri.toString(),
          line: f.range.start.line,
          text: diagnosticText(f.issue),
          at: now,
          step,
        });
      }
      return finding;
    });
    for (const f of resolved) {
      this.journal.update(f.id, { resolvedAt: now });
    }
    this.byUri.set(uri.toString(), [...all.filter(outside), ...added]);
    this.show(uri);
  }

  /** Замечания, текст которых VS Code покажет в hover в этой точке, в том же порядке, что и он. */
  at(uri: vscode.Uri, position: vscode.Position): Finding[] {
    return (this.byUri.get(uri.toString()) ?? [])
      .filter((f) => !f.hidden && hoverRange(f).contains(position))
      .sort((a, b) => a.range.start.compareTo(b.range.start));
  }

  /** Открывает ступень замечания. undefined — замечания уже нет: файл разобран заново. */
  reveal(id: string, step: Step): Finding | undefined {
    for (const list of this.byUri.values()) {
      const finding = list.find((f) => f.id === id);
      if (finding) {
        finding.step = reveal(finding.step, step);
        this.journal.update(id, { step: finding.step });
        return finding;
      }
    }
    return undefined;
  }

  private show(uri: vscode.Uri) {
    const visible = (this.byUri.get(uri.toString()) ?? []).filter((f) => !f.hidden);
    this.diagnostics.set(uri, visible.map(toDiagnostic));
  }

  dispose() {
    this.subscription.dispose();
    this.diagnostics.dispose();
  }

  /**
   * Замечания едут вместе с текстом. Иначе после правок выше функции новый разбор
   * принял бы чужие замечания за свои, а hover искал бы их не на тех строках.
   */
  private edited(e: vscode.TextDocumentChangeEvent) {
    const list = this.byUri.get(e.document.uri.toString());
    if (!list?.length || !e.contentChanges.length) {
      return;
    }
    const doc = e.document;
    const edits = lineEdits(e);
    let changed = false;
    for (const f of list) {
      // Правка задела строки замечания — совет мог устареть, прячем его до нового разбора.
      if (
        !f.hidden &&
        edits.some((e) => e.start <= f.range.end.line && e.end >= f.range.start.line)
      ) {
        f.hidden = true;
        changed = true;
      }
      const lines = trackRange({ start: f.range.start.line, end: f.range.end.line }, edits);
      if (lines.start === f.range.start.line && lines.end === f.range.end.line) {
        continue;
      }
      const start = Math.min(lines.start, doc.lineCount - 1);
      const end = Math.min(lines.end, doc.lineCount - 1);
      f.range = new vscode.Range(
        start,
        doc.lineAt(start).firstNonWhitespaceCharacterIndex,
        end,
        doc.lineAt(end).text.length,
      );
      changed = true;
    }
    if (changed) {
      this.show(doc.uri);
    }
  }
}

/**
 * Hint (это suggestion) VS Code рисует точками под первыми двумя символами и только там показывает
 * его текст. Кнопки без текста намёка непонятно к чему относятся, поэтому и hover — только там.
 */
function hoverRange({ range, issue }: Finding) {
  return issue.severity === 'suggestion'
    ? new vscode.Range(range.start, range.start.translate(0, 2))
    : range;
}

function toDiagnostic({ range, issue }: Finding) {
  const d = new vscode.Diagnostic(range, diagnosticText(issue), SEVERITY[issue.severity]);
  d.source = 'Adviser';
  d.code = issue.patternId;
  return d;
}
