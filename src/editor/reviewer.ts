import * as vscode from 'vscode';
import {
  createFallbackProvider,
  createProvider,
  type ConfiguredProvider,
} from '../config/provider';
import { cacheKey, LruCache } from '../core/cache';
import { applyCourse, applyCourseText } from '../core/course';
import { toFileLines, type LineRange } from '../core/codeRange';
import type { Presentation } from '../core/disclosure';
import { runReview, runStructured, type Usage } from '../core/engine';
import { hintLeak } from '../core/hintGuard';
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
import {
  buildCheckPrompt,
  CHECK_PROMPT_VERSION,
  checkFallback,
  checkSchema,
} from '../core/selfCheck';
import { readBundled, readPatterns } from './bundled';
import { collectContext, readRules } from './context';
import type { Findings } from './findings';
import { CONFIG_PATH, type ProjectSettings } from './settings';
import type { UsageTracker } from './usage';
import type { Consent } from './consent';

export type CheckOutcome =
  | { kind: 'checked'; understood: boolean; feedback: string }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; error: string; invalid: boolean };

const textOf = (doc: vscode.TextDocument, range: LineRange) =>
  doc.getText(new vscode.Range(range.start, 0, range.end, doc.lineAt(range.end).text.length));

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
    const code = textOf(doc, range);
    const settings = this.allowed(doc);
    if (typeof settings === 'string') {
      return { kind: 'refused', message: settings };
    }
    const main = await createProvider(this.context);
    if (typeof main === 'string') {
      return { kind: 'refused', message: main };
    }

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
    const hit = fromCache(main);
    if (hit) {
      return hit;
    }

    // Лимит в деньгах проверяем после кэша: ответ из кэша бесплатный.
    const budget = this.withinBudget(main);
    if (typeof budget === 'string') {
      return { kind: 'refused', message: budget };
    }
    const { configured } = budget;
    if (configured !== main) {
      const fallbackHit = fromCache(configured);
      if (fallbackHit) {
        return fallbackHit;
      }
    }
    const denied = await this.denied(configured, interactive);
    if (denied) {
      return { kind: 'refused', message: denied };
    }
    this.log.info(`${source}: разбор ${where}, ${version}, уровень ${level}, язык ${language}`);
    const spent = { inputTokens: 0, outputTokens: 0 };
    const result = await runReview(configured.provider, request, signal, (u) => {
      spent.inputTokens += u.inputTokens;
      spent.outputTokens += u.outputTokens;
      budget.spend(u);
    });
    if (signal?.aborted) {
      this.log.info(`${where}: код изменился, разбор отменён`);
      return { kind: 'aborted' };
    }
    if (!result.ok) {
      this.log.warn(result.error);
      return { kind: 'failed', error: result.error, invalid: result.invalid };
    }

    const normalized = normalizePatternIds(result.review, patterns);
    if (normalized.unknown.length) {
      // Повод дополнить patterns/patterns.json.
      this.log.info(`patternId не из списка, записаны как other: ${normalized.unknown.join(', ')}`);
    }
    // Намёк, который называет новое из решения, выдаёт ответ: убираем — сразу объяснение.
    const review = {
      ...normalized.review,
      issues: normalized.review.issues.map((issue) => {
        const leak = hintLeak(issue.hint, issue.fix.code, code);
        if (!leak) {
          return issue;
        }
        this.log.info(`${issue.patternId}: намёк выдавал ответ («${leak}»), показываю объяснение`);
        return { ...issue, hint: '' };
      }),
    };
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

  /**
   * «Проверь меня»: ответ учащегося на замечание (src/core/selfCheck.ts). Те же правила отправки,
   * бюджет и согласие, что и у разбора, но без кэша: ответы каждый раз свои.
   */
  async check(
    doc: vscode.TextDocument,
    range: LineRange,
    issue: Issue,
    answer: string,
  ): Promise<CheckOutcome> {
    try {
      return await this.runCheck(doc, range, issue, answer);
    } catch (e) {
      this.log.error(
        `проверка не удалась: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
      );
      return { kind: 'failed', error: String(e), invalid: false };
    }
  }

  private async runCheck(
    doc: vscode.TextDocument,
    range: LineRange,
    issue: Issue,
    answer: string,
  ): Promise<CheckOutcome> {
    const code = textOf(doc, range);
    const settings = this.allowed(doc);
    if (typeof settings === 'string') {
      return { kind: 'refused', message: settings };
    }
    const main = await createProvider(this.context);
    if (typeof main === 'string') {
      return { kind: 'refused', message: main };
    }
    const budget = this.withinBudget(main);
    if (typeof budget === 'string') {
      return { kind: 'refused', message: budget };
    }
    const denied = await this.denied(budget.configured, true);
    if (denied) {
      return { kind: 'refused', message: denied };
    }
    const template = parseTemplate(
      await readBundled(this.context, 'prompts', `${CHECK_PROMPT_VERSION}.md`),
    );
    const language = resolveLanguage(settings.language, vscode.env.language);
    const built = buildCheckPrompt(template, {
      languageId: doc.languageId,
      code,
      level: settings.level,
      language,
      issue,
      answer,
    });
    const request = {
      ...built,
      system: redact(built.system).text,
      prompt: redact(built.prompt).text,
    };
    this.log.info(`проверка ответа: ${issue.patternId}, ${CHECK_PROMPT_VERSION}`);
    const result = await runStructured(
      checkSchema,
      budget.configured.provider,
      request,
      undefined,
      budget.spend,
    );
    if (!result.ok) {
      this.log.warn(result.error);
      return { kind: 'failed', error: result.error, invalid: result.invalid };
    }
    const { understood } = result.data;
    let { feedback } = result.data;
    // Отзыв на неверный ответ — новый вопрос, а не решение: если выдаёт решение, заменяем.
    const leak = !understood && hintLeak(feedback, issue.fix.code, code);
    if (leak) {
      this.log.info(`${issue.patternId}: отзыв выдавал ответ («${leak}»), заменён`);
      feedback = checkFallback(language);
    }
    this.log.info(`${issue.patternId}: ${understood ? 'объяснил верно' : 'пока не понял'}`);
    return { kind: 'checked', understood, feedback: applyCourseText(feedback, settings.course) };
  }

  /** Можно ли отправлять этот файл. Строка — почему нельзя. */
  private allowed(doc: vscode.TextDocument): Settings | string {
    if (isEnvFile(doc.uri.fsPath)) {
      return 'файлы .env* не отправляются';
    }
    const settings = this.settings.get(doc.uri);
    if (settings.configError) {
      return `исправь ${CONFIG_PATH}: ${settings.configError}`;
    }
    if (settings.course.silent) {
      return `контрольная: в этой папке Adviser молчит (${CONFIG_PATH})`;
    }
    if (this.settings.ignored(doc, settings)) {
      return `файл в ignore ${CONFIG_PATH}, не отправляю`;
    }
    return settings;
  }

  /**
   * Лимит в деньгах: исчерпан — запасная модель, если задана. spend учитывает расход: запасная
   * модель на этом компьютере и бесплатная, в бюджет её расход не идёт.
   */
  private withinBudget(
    main: ConfiguredProvider,
  ): { configured: ConfiguredProvider; spend: (u: Usage) => void } | string {
    const over = this.usage.exceeded();
    if (!over) {
      return { configured: main, spend: (u) => void this.usage.add(u) };
    }
    const fallback = createFallbackProvider();
    if (!fallback) {
      return `${over}, разборы на паузе (настройки adviser.budget)`;
    }
    this.log.info(`${over}: разбираю запасной моделью ${fallback.destination!.model}`);
    return { configured: fallback, spend: () => {} };
  }

  /** Нет согласия на отправку на этот сервер — почему; автопилот окно не показывает. */
  private async denied(
    configured: ConfiguredProvider,
    interactive: boolean,
  ): Promise<string | undefined> {
    if (!this.consent.needed(configured.destination)) {
      return undefined;
    }
    if (!interactive) {
      return 'нужно разрешение на отправку кода: выполни «Adviser: Разобрать эту функцию»';
    }
    return (await this.consent.ask(configured.destination))
      ? undefined
      : 'отправка кода не разрешена';
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
  issues: filterIssues(review.issues, settings).map((i) => applyCourse(i, settings.course)),
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
