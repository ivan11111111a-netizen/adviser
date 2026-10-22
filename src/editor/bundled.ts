import * as vscode from 'vscode';
import type { Translate } from '../core/i18n';
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

/** Перевод для ядра: ядро не импортирует vscode, поэтому vscode.l10n.t передаётся ему так. */
export const translate: Translate = (message, ...args) => vscode.l10n.t(message, ...args);

/** Язык интерфейса VS Code — для названий типов ошибок и дат. Переводов, кроме русского, нет. */
export const uiLanguage = (): 'ru' | 'en' => (vscode.env.language.startsWith('ru') ? 'ru' : 'en');

/** Название типа ошибки на языке интерфейса. */
export function patternTitle(patterns: Pattern[], patternId: string): string {
  return patterns.find((p) => p.id === patternId)?.title[uiLanguage()] ?? patternId;
}
