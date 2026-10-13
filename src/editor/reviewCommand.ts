import * as vscode from 'vscode';
import { createProvider } from '../config/provider';
import { pickRange, toFileLines, type LineRange } from '../core/codeRange';
import { runReview } from '../core/engine';
import { normalizePatternIds, parsePatterns, patternsFor } from '../core/patterns';
import {
  buildPrompt,
  LEVELS,
  parseTemplate,
  PROMPT_VERSION,
  resolveLanguage,
} from '../core/promptBuilder';
import type { Findings } from './findings';
import { documentSymbols } from './symbols';

/** «Adviser: Разобрать эту функцию» — функция под курсором или выделение. Ошибки без всплывающих окон. */
export async function reviewFunction(
  context: vscode.ExtensionContext,
  findings: Findings,
  log: vscode.LogOutputChannel,
) {
  const status = (text: string) => vscode.window.setStatusBarMessage(`Adviser: ${text}`, 6000);
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    status('открой файл с кодом');
    return;
  }
  const doc = editor.document;
  const range = editor.selection.isEmpty
    ? pickRange(await documentSymbols(doc.uri), editor.selection.active.line, doc.lineCount)
    : selectedLines(editor.selection);

  const provider = await createProvider(context);
  if (typeof provider === 'string') {
    status(provider);
    log.warn(provider);
    return;
  }

  const template = parseTemplate(await readBundled(context, 'prompts', `${PROMPT_VERSION}.md`));
  const patterns = parsePatterns(
    JSON.parse(await readBundled(context, 'patterns', 'patterns.json')),
  );
  const code = doc.getText(
    new vscode.Range(range.start, 0, range.end, doc.lineAt(range.end).text.length),
  );
  const config = vscode.workspace.getConfiguration('adviser', doc.uri);
  const level = LEVELS.find((l) => l === config.get<string>('level')) ?? 'beginner';
  const language = resolveLanguage(config.get<string>('language'), vscode.env.language);
  const request = buildPrompt(template, {
    languageId: doc.languageId,
    code,
    level,
    language,
    patterns: patternsFor(patterns, doc.languageId),
  });

  log.info(
    `разбор ${doc.uri.fsPath}:${range.start + 1}-${range.end + 1}, уровень ${level}, язык ${language}`,
  );
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Adviser: разбираю…' },
    () => runReview(provider, request),
  );
  if (!result.ok) {
    log.error(result.error);
    status('не получилось разобрать, подробности в Output → Adviser');
    return;
  }

  const { review, unknown } = normalizePatternIds(result.review, patterns);
  if (unknown.length) {
    // Повод дополнить patterns/patterns.json.
    log.info(`patternId не из списка, записаны как other: ${unknown.join(', ')}`);
  }
  const { issues, summary } = review;
  log.info(
    `${summary} (замечаний: ${issues.length}: ${issues.map((i) => i.patternId).join(', ')})`,
  );
  findings.replace(
    doc.uri,
    range,
    issues.map((issue) => {
      const lines = toFileLines(issue, range);
      return {
        issue,
        languageId: doc.languageId,
        range: new vscode.Range(
          lines.start,
          doc.lineAt(lines.start).firstNonWhitespaceCharacterIndex,
          lines.end,
          doc.lineAt(lines.end).text.length,
        ),
      };
    }),
  );
  status(issues.length ? `замечаний: ${issues.length}` : 'замечаний нет');
}

/** Файл из папки расширения: промпты и patterns.json едут внутри .vsix. */
async function readBundled(context: vscode.ExtensionContext, ...path: string[]) {
  return new TextDecoder().decode(
    await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, ...path)),
  );
}

/** Выделение до начала следующей строки эту строку не захватывает. */
function selectedLines(selection: vscode.Selection): LineRange {
  const end =
    selection.end.character === 0 && selection.end.line > selection.start.line
      ? selection.end.line - 1
      : selection.end.line;
  return { start: selection.start.line, end };
}
