import * as vscode from 'vscode';
import {
  createFallbackProvider,
  createProvider,
  type ConfiguredProvider,
} from '../config/provider';
import { cacheKey, LruCache } from '../core/cache';
import { toFileLines, type LineRange } from '../core/codeRange';
import type { Presentation } from '../core/disclosure';
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
import { redact } from '../core/redact';
import { isEnvFile } from '../core/scheduler';
import { readBundled, readPatterns } from './bundled';
import { collectContext, readRules } from './context';
import type { Findings } from './findings';
import { CONFIG_PATH, type ProjectSettings } from './settings';
import type { UsageTracker } from './usage';
import type { Consent } from './consent';

export type Outcome =
  | { kind: 'reviewed'; review: Review; cached: boolean; presentation: Presentation }
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
    private readonly usage: UsageTracker,
    private readonly consent: Consent,
  ) {}

  async review(
    doc: vscode.TextDocument,
    range: LineRange,
    source: string,
    signal?: AbortSignal,
    /** Человек сам запустил разбор: можно спросить согласие в окне. Автопилот не спрашивает. */
    interactive = false,
  ): Promise<Outcome> {
    try {
      return await this.run(doc, range, source, signal, interactive);
    } catch (e) {
      // Сбой самого Adviser (нет раздела в промпте, не читается patterns.json…): без всплывающих
      // окон, как и ошибки сети, — в лог и в статус-бар.
      this.log.error(
        `разбор не удался: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
      );
      return { kind: 'failed', error: String(e), invalid: false };
    }
  }

  private async run(
    doc: vscode.TextDocument,
    range: LineRange,
    source: string,
    signal: AbortSignal | undefined,
    interactive: boolean,
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
    const main = await createProvider(this.context);
    if (typeof main === 'string') {
      return { kind: 'refused', message: main };
    }
    let configured: ConfiguredProvider = main;

    // Читаем при каждом разборе: в F5 правка промпта видна без перезапуска.
    const version = this.promptVersion();
    const template = parseTemplate(await readBundled(this.context, 'prompts', `${version}.md`));
    const patterns = await readPatterns(this.context);
    const { level } = settings;
    const language = resolveLanguage(settings.language, vscode.env.language);
    const built = buildPrompt(template, {
      languageId: doc.languageId,
      code,
      level,
      language,
      patterns: patternsFor(patterns, doc.languageId),
      profile: this.profile(),
      // Окружение собираем, только если промпт знает, что с ним делать.
      context: template.base.includes('<context>')
        ? await collectContext(doc, range, (other) => this.canSend(other))
        : undefined,
      rules: template.base.includes('{{rules}}') ? await readRules(doc, settings) : undefined,
    });
    // Секреты маскируем во всём, что уходит: в коде, окружении и правилах проекта.
    const system = redact(built.system);
    const prompt = redact(built.prompt);
    const request = { ...built, system: system.text, prompt: prompt.text };
    if (system.count + prompt.count) {
      this.log.info(`скрыто секретов перед отправкой: ${system.count + prompt.count}`);
    }

    const where = `${doc.uri.fsPath}:${range.start + 1}-${range.end + 1}`;
    const fromCache = (provider: ConfiguredProvider): Outcome | undefined => {
      const cached = this.cache.get(cacheKey(provider.id, request.system, request.prompt));
      if (!cached) {
        return undefined;
      }
      this.log.info(`${source}: ${where} — ответ из кэша`);
      return signal?.aborted
        ? { kind: 'aborted' }
        : {
            kind: 'reviewed',
            review: shown(cached, settings),
            cached: true,
            presentation: presentationOf(settings),
          };
    };
    const hit = fromCache(configured);
    if (hit) {
      return hit;
    }

    // Лимит в деньгах проверяем после кэша: ответ из кэша бесплатный.
    const over = this.usage.exceeded();
    if (over) {
      const fallback = createFallbackProvider();
      if (!fallback) {
        return { kind: 'refused', message: `${over}, разборы на паузе (настройки adviser.budget)` };
      }
      this.log.info(`${over}: разбираю запасной моделью ${fallback.destination!.model}`);
      configured = fallback;
      const fallbackHit = fromCache(configured);
      if (fallbackHit) {
        return fallbackHit;
      }
    }
    if (this.consent.needed(configured.destination)) {
      if (!interactive) {
        return {
          kind: 'refused',
          message: 'нужно разрешение на отправку кода: выполни «Adviser: Разобрать эту функцию»',
        };
      }
      if (!(await this.consent.ask(configured.destination))) {
        return { kind: 'refused', message: 'отправка кода не разрешена' };
      }
    }
    this.log.info(`${source}: разбор ${where}, ${version}, уровень ${level}, язык ${language}`);
    const spent = { inputTokens: 0, outputTokens: 0 };
    const result = await runReview(configured.provider, request, signal, (u) => {
      spent.inputTokens += u.inputTokens;
      spent.outputTokens += u.outputTokens;
      // Запасная модель — на этом компьютере и бесплатная: в бюджет её расход не идёт.
      if (!over) {
        void this.usage.add(u);
      }
    });
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
    const tokens = spent.inputTokens
      ? `, токенов ${spent.inputTokens} → ${spent.outputTokens}`
      : '';
    this.log.info(
      `${summary} (замечаний: ${issues.length}: ${issues.map((i) => i.patternId).join(', ')}${tokens})`,
    );
    this.cache.set(cacheKey(configured.id, request.system, request.prompt), review);
    return {
      kind: 'reviewed',
      review: shown(review, settings),
      cached: false,
      presentation: presentationOf(settings),
    };
  }

  /** Другой файл, который попадает в окружение: те же правила, что и для разбираемого. */
  private canSend(doc: vscode.TextDocument): boolean {
    const settings = this.settings.get(doc.uri);
    return (
      !isEnvFile(doc.uri.fsPath) && !settings.configError && !this.settings.ignored(doc, settings)
    );
  }

  /** Версия промпта. adviser.dev.prompt — чтобы автор погонял черновик в F5, не меняя код. */
  private promptVersion(): string {
    const dev = vscode.workspace.getConfiguration('adviser').get<string>('dev.prompt', '').trim();
    const fromSources = this.context.extensionMode !== vscode.ExtensionMode.Production;
    // Только имя файла из prompts/, без путей.
    return fromSources && /^[\w.-]+$/.test(dev) ? dev : PROMPT_VERSION;
  }
}

/** В кэше — полный ответ, а фильтры проекта применяем при показе: их можно поменять на ходу. */
const shown = (review: Review, settings: Settings): Review => ({
  ...review,
  issues: filterIssues(review.issues, settings),
});

/** В режиме «Ревьюер» ступеней нет — всё сразу; в остальных — по ступеням. */
const presentationOf = (settings: Settings): Presentation =>
  settings.mode === 'reviewer' ? 'reviewer' : 'mentor';

/** Замечания разобранного диапазона — в подчёркивания и hover; прежние в этом диапазоне уходят. */
export function showReview(
  findings: Findings,
  doc: vscode.TextDocument,
  range: LineRange,
  issues: Issue[],
  presentation: Presentation,
) {
  findings.replace(
    doc.uri,
    range,
    issues.map((issue) => {
      const lines = toFileLines(issue, range);
      return {
        issue,
        languageId: doc.languageId,
        presentation,
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
