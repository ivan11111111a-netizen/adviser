import * as vscode from 'vscode';
import type { LineRange } from '../core/codeRange';
import {
  buildContext,
  callSites,
  npmDependencies,
  pythonRequirements,
} from '../core/contextBuilder';
import type { Settings } from '../core/projectConfig';
import { AGENT_FILES, renderRules, RULES_FILE } from '../core/rules';
import { ownerUri } from './settings';
import { documentSymbols } from './symbols';

/** Окружение функции для промпта: замечания инструментов, скелет файла, вызовы, зависимости. */
export async function collectContext(
  doc: vscode.TextDocument,
  range: LineRange,
  allowed: (doc: vscode.TextDocument) => boolean,
): Promise<string> {
  const lines = Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
  const [symbols, dependencies, calls] = await Promise.all([
    documentSymbols(doc.uri),
    readDependencies(doc),
    calledFromOtherFiles(doc, lines, range, allowed),
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
  return buildContext({
    lines,
    languageId: doc.languageId,
    range,
    symbols,
    diagnostics,
    dependencies,
    calls,
  });
}

/**
 * Первые строки вызываемых функций из других файлов проекта (6.3 плана, пункт 3).
 * Свой файл уже есть в скелете; зависимости и файлы, которые нельзя отправлять, пропускаем.
 */
async function calledFromOtherFiles(
  doc: vscode.TextDocument,
  lines: string[],
  range: LineRange,
  allowed: (doc: vscode.TextDocument) => boolean,
): Promise<string[]> {
  const folder = vscode.workspace.getWorkspaceFolder(ownerUri(doc.uri));
  if (!folder) {
    return [];
  }
  const found = await Promise.all(
    callSites(lines, range).map(async ({ line, character }) => {
      const defs = await vscode.commands.executeCommand<
        (vscode.Location | vscode.LocationLink)[] | undefined
      >('vscode.executeDefinitionProvider', doc.uri, new vscode.Position(line, character));
      const def = defs?.[0];
      if (!def) {
        return [];
      }
      const uri = 'targetUri' in def ? def.targetUri : def.uri;
      const at = 'targetUri' in def ? def.targetRange.start.line : def.range.start.line;
      if (
        uri.toString() === doc.uri.toString() ||
        vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== folder.uri.toString() ||
        uri.path.includes('/node_modules/')
      ) {
        return [];
      }
      const target = await vscode.workspace.openTextDocument(uri);
      if (!allowed(target)) {
        return [];
      }
      return [
        `${vscode.workspace.asRelativePath(uri, false)}:${at + 1} | ${target.lineAt(at).text.trim()}`,
      ];
    }),
  );
  return [...new Set(found.flat())];
}

/** Правила стиля из корня проекта: .adviser/rules.md и, если включено, файлы для ИИ-агентов. */
export async function readRules(doc: vscode.TextDocument, settings: Settings): Promise<string> {
  const folder = vscode.workspace.getWorkspaceFolder(ownerUri(doc.uri));
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
  const folder = vscode.workspace.getWorkspaceFolder(ownerUri(doc.uri));
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
