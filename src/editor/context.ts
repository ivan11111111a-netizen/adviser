import * as vscode from 'vscode';
import type { LineRange } from '../core/codeRange';
import { buildContext, npmDependencies, pythonRequirements } from '../core/contextBuilder';
import type { Settings } from '../core/projectConfig';
import { AGENT_FILES, renderRules, RULES_FILE } from '../core/rules';
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

/** Правила стиля из корня проекта: .adviser/rules.md и, если включено, файлы для ИИ-агентов. */
export async function readRules(doc: vscode.TextDocument, settings: Settings): Promise<string> {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (!folder) {
    return '';
  }
  const names = [RULES_FILE, ...(settings.readAgentFiles ? AGENT_FILES : [])];
  const files = await Promise.all(
    names.map(async (name) => {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, name));
        return [{ name, text: new TextDecoder().decode(bytes) }];
      } catch {
        // Файла правил нет — это нормально, их заводят не во всех проектах.
        return [];
      }
    }),
  );
  return renderRules(files.flat());
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
