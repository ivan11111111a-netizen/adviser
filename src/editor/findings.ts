import * as vscode from 'vscode';
import type { LineRange } from '../core/codeRange';
import { diagnosticText, firstStep, reveal, type Step } from '../core/disclosure';
import type { Issue, Severity } from '../core/reviewSchema';

export interface NewFinding {
  range: vscode.Range;
  issue: Issue;
  languageId: string;
}

export interface Finding extends NewFinding {
  /** По нему кнопки в hover находят замечание. После нового разбора старые id не находятся. */
  id: string;
  uri: vscode.Uri;
  step: Step;
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
  private nextId = 1;

  /** Заменяет замечания в разобранном диапазоне, замечания по другим функциям файла остаются. */
  replace(uri: vscode.Uri, reviewed: LineRange, findings: NewFinding[]) {
    const kept = (this.byUri.get(uri.toString()) ?? []).filter(
      (f) => f.range.end.line < reviewed.start || f.range.start.line > reviewed.end,
    );
    const added = findings.map((f) => ({
      ...f,
      uri,
      id: String(this.nextId++),
      step: firstStep(f.issue.severity),
    }));
    const all = [...kept, ...added];
    this.byUri.set(uri.toString(), all);
    this.diagnostics.set(uri, all.map(toDiagnostic));
  }

  /** В порядке начала подчёркиваний — так же VS Code перечисляет их тексты в hover. */
  at(uri: vscode.Uri, position: vscode.Position): Finding[] {
    return (this.byUri.get(uri.toString()) ?? [])
      .filter((f) => f.range.contains(position))
      .sort((a, b) => a.range.start.compareTo(b.range.start));
  }

  /** Открывает ступень замечания. undefined — замечания уже нет: файл разобран заново. */
  reveal(id: string, step: Step): Finding | undefined {
    for (const list of this.byUri.values()) {
      const finding = list.find((f) => f.id === id);
      if (finding) {
        finding.step = reveal(finding.step, step);
        return finding;
      }
    }
    return undefined;
  }

  dispose() {
    this.diagnostics.dispose();
  }
}

function toDiagnostic({ range, issue }: Finding) {
  const d = new vscode.Diagnostic(range, diagnosticText(issue), SEVERITY[issue.severity]);
  d.source = 'Adviser';
  d.code = issue.patternId;
  return d;
}
