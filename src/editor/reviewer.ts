import * as vscode from 'vscode';
import { createProvider } from '../config/provider';
import { cacheKey, LruCache } from '../core/cache';
import { toFileLines, type LineRange } from '../core/codeRange';
import { runReview } from '../core/engine';
import { normalizePatternIds, patternsFor } from '../core/patterns';
import {
  buildPrompt,
  parseTemplate,
  PROMPT_VERSION,
  resolveLanguage,
  type PromptInput,
} from '../core/promptBuilder';
import type { Issue, Review } from '../core/reviewSchema';
import { filterIssues, type Settings } from '../core/projectConfig';
import { isEnvFile } from '../core/scheduler';
import { readBundled, readPatterns } from './bundled';
import type { Findings } from './findings';
import { CONFIG_PATH, type ProjectSettings } from './settings';

export type Outcome =
  | { kind: 'reviewed'; review: Review; cached: boolean }
  /** Разбирать нельзя: провайдер не настроен или файл не отправляется. message — для статус-бара. */
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; error: string; invalid: boolean }
  /** Код изменился, пока шёл разбор. */
  | { kind: 'aborted' };

/** Разбор строк документа: промпт, кэш, модель, проверка ответа. Общий для команды и автопилота. */
export class Reviewer {
  private readonly cache = new LruCache<Review>(200);

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel,
    /** Частые ошибки учащегося из журнала. Идут в промпт, если в нём есть {{profile}}. */
    private readonly profile: () => PromptInput['profile'],
    private readonly settings: ProjectSettings,
  ) {}

  async review(
    doc: vscode.TextDocument,
    range: LineRange,
    source: string,
    signal?: AbortSignal,
  ): Promise<Outcome> {
    // Код берём до первого await: правка после этого отменит разбор через signal.
    const code = doc.getText(
      new vscode.Range(range.start, 0, range.end, doc.lineAt(range.end).text.length),
    );
    if (isEnvFile(doc.uri.fsPath)) {
      return { kind: 'refused', message: 'файлы .env* не отправляются' };
    }
    const settings = this.settings.get(doc.uri);
    if (settings.configError) {
      return { kind: 'refused', message: `исправь ${CONFIG_PATH}: ${settings.configError}` };
    }
    if (this.settings.ignored(doc, settings)) {
      return { kind: 'refused', message: `файл в ignore ${CONFIG_PATH}, не отправляю` };
    }
    const configured = await createProvider(this.context);
    if (typeof configured === 'string') {
      return { kind: 'refused', message: configured };
    }

    // Читаем при каждом разборе: в F5 правка промпта видна без перезапуска.
    const template = parseTemplate(
      await readBundled(this.context, 'prompts', `${PROMPT_VERSION}.md`),
    );
    const patterns = await readPatterns(this.context);
    const { level } = settings;
    const language = resolveLanguage(settings.language, vscode.env.language);
    const request = buildPrompt(template, {
      languageId: doc.languageId,
      code,
      level,
      language,
      patterns: patternsFor(patterns, doc.languageId),
      profile: this.profile(),
    });

    const where = `${doc.uri.fsPath}:${range.start + 1}-${range.end + 1}`;
    const key = cacheKey(configured.id, request.system, request.prompt);
    const cached = this.cache.get(key);
    if (cached) {
      this.log.info(`${source}: ${where} — ответ из кэша`);
      return signal?.aborted
        ? { kind: 'aborted' }
        : { kind: 'reviewed', review: shown(cached, settings), cached: true };
    }

    this.log.info(`${source}: разбор ${where}, уровень ${level}, язык ${language}`);
    const result = await runReview(configured.provider, request, signal);
    if (signal?.aborted) {
      this.log.info(`${where}: код изменился, разбор отменён`);
      return { kind: 'aborted' };
    }
    if (!result.ok) {
      this.log.warn(result.error);
      return { kind: 'failed', error: result.error, invalid: result.invalid };
    }

    const { review, unknown } = normalizePatternIds(result.review, patterns);
    if (unknown.length) {
      // Повод дополнить patterns/patterns.json.
      this.log.info(`patternId не из списка, записаны как other: ${unknown.join(', ')}`);
    }
    const { issues, summary } = review;
    this.log.info(
      `${summary} (замечаний: ${issues.length}: ${issues.map((i) => i.patternId).join(', ')})`,
    );
    this.cache.set(key, review);
    return { kind: 'reviewed', review: shown(review, settings), cached: false };
  }
}

/** В кэше — полный ответ, а фильтры проекта применяем при показе: их можно поменять на ходу. */
const shown = (review: Review, settings: Settings): Review => ({
  ...review,
  issues: filterIssues(review.issues, settings),
});

/** Замечания разобранного диапазона — в подчёркивания и hover; прежние в этом диапазоне уходят. */
export function showReview(
  findings: Findings,
  doc: vscode.TextDocument,
  range: LineRange,
  issues: Issue[],
) {
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
}
