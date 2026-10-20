import * as vscode from 'vscode';
import type { LineRange } from '../core/codeRange';
import { buildContext, npmDependencies, pythonRequirements } from '../core/contextBuilder';
import { documentSymbols } from './symbols';

/** Окружение функции для промпта: замечания инструментов, скелет файла, зависимости проекта. */
export async function collectContext(doc: vscode.TextDocument, range: LineRange): Promise<string> {
  const [symbols, dependencies] = await Promise.all([
    documentSymbols(doc.uri),
    readDependencies(doc),
  ]);
  const diagnostics = vscode.languages
    .getDiagnostics(doc.uri)
    .filter(
      (d) =>
        d.source !== 'Adviser' &&
        d.severity !== vscode.DiagnosticSeverity.Hint &&
        d.range.start.line <= range.end &&
        d.range.end.line >= range.start,
    )
    .map((d) => ({ line: d.range.start.line, message: d.message, source: d.source }));
  const lines = Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
  return buildContext({
    lines,
    languageId: doc.languageId,
    range,
    symbols,
    diagnostics,
    dependencies,
  });
}

/** Версии зависимостей из корня проекта: package.json или requirements.txt. */
async function readDependencies(doc: vscode.TextDocument): Promise<Record<string, string>> {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (!folder) {
    return {};
  }
  const python = doc.languageId === 'python';
  const file = vscode.Uri.joinPath(folder.uri, python ? 'requirements.txt' : 'package.json');
  let text: string;
  try {
    text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
  } catch {
    // Файла нет или он не читается — окружение необязательно, разбираем без версий.
    return {};
  }
  return python ? pythonRequirements(text) : npmDependencies(text);
}
