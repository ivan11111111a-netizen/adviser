import * as vscode from 'vscode';
import type { LineRange } from '../core/codeRange';
import type { Issue, Severity } from '../core/reviewSchema';

export interface Finding {
  range: vscode.Range;
  issue: Issue;
  languageId: string;
}

// Error не используем никогда: его легко спутать с ошибкой компилятора.
const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Warning,
  warning: vscode.DiagnosticSeverity.Information,
  suggestion: vscode.DiagnosticSeverity.Hint,
};

/** Замечания по файлам: подчёркивания в редакторе и данные для hover. */
export class Findings implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('adviser');
  private readonly byUri = new Map<string, Finding[]>();

  /** Заменяет замечания в разобранном диапазоне, замечания по другим функциям файла остаются. */
  replace(uri: vscode.Uri, reviewed: LineRange, findings: Finding[]) {
    const kept = (this.byUri.get(uri.toString()) ?? []).filter(
      (f) => f.range.end.line < reviewed.start || f.range.start.line > reviewed.end,
    );
    const all = [...kept, ...findings];
    this.byUri.set(uri.toString(), all);
    this.diagnostics.set(uri, all.map(toDiagnostic));
  }

  at(uri: vscode.Uri, position: vscode.Position): Finding[] {
    return (this.byUri.get(uri.toString()) ?? []).filter((f) => f.range.contains(position));
  }

  dispose() {
    this.diagnostics.dispose();
  }
}

function toDiagnostic({ range, issue }: Finding) {
  const d = new vscode.Diagnostic(range, issue.hint, SEVERITY[issue.severity]);
  d.source = 'Adviser';
  d.code = issue.patternId;
  return d;
}

/** Пока без ступеней (это этап 2): намёк виден в подчёркивании, здесь объяснение и решение. */
export function hoverProvider(findings: Findings): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const here = findings.at(document.uri, position);
      if (!here.length) {
        return undefined;
      }
      const md = new vscode.MarkdownString();
      for (const { issue, languageId } of here) {
        md.appendMarkdown(`**Adviser · почему.** ${issue.explanation}\n\n`);
        md.appendMarkdown(`**Решение.** ${issue.fix.description}\n`);
        md.appendCodeblock(issue.fix.code, languageId);
        if (issue.readMore?.startsWith('https://')) {
          md.appendMarkdown(`[Подробнее](${issue.readMore})\n\n`);
        }
      }
      return new vscode.Hover(md);
    },
  };
}
