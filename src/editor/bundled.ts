import * as vscode from 'vscode';
import { parsePatterns, type Pattern } from '../core/patterns';

/** Файл из папки расширения: промпты и patterns.json едут внутри .vsix. */
export async function readBundled(context: vscode.ExtensionContext, ...path: string[]) {
  return new TextDecoder().decode(
    await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, ...path)),
  );
}

export async function readPatterns(context: vscode.ExtensionContext): Promise<Pattern[]> {
  return parsePatterns(JSON.parse(await readBundled(context, 'patterns', 'patterns.json')));
}

/** Название типа ошибки для интерфейса. Интерфейс пока только русский. */
export function patternTitle(patterns: Pattern[], patternId: string): string {
  return patterns.find((p) => p.id === patternId)?.title.ru ?? patternId;
}
