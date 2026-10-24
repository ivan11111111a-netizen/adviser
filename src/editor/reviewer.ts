import * as vscode from 'vscode';
import type { z } from 'zod';
import {
  createFallbackProvider,
  createProvider,
  type ConfiguredProvider,
} from '../config/provider';
import { cacheKey, LruCache } from '../core/cache';
import { applyCourse, applyCourseText } from '../core/course';
import { toFileLines, type LineRange } from '../core/codeRange';
import type { Presentation } from '../core/disclosure';
import {
  ProviderRefusal,
  runReview,
  runStructured,
  type ModelRequest,
  type Usage,
} from '../core/engine';
import { hintLeak } from '../core/hintGuard';
import {
  buildExercisePrompt,
  EXERCISE_PROMPT_VERSION,
  exerciseSchema,
  type Exercise,
} from '../core/exercise';
import { normalizePatternIds, patternsFor, type Pattern } from '../core/patterns';
import {
  buildPrompt,
  parseTemplate,
  PROMPT_VERSION,
  resolveLanguage,
  type AdviceLanguage,
  type PromptInput,
  type PromptTemplate,
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
import {
  ANSWERS_PROMPT_VERSION,
  answersSchema,
  buildAnswersPrompt,
  buildQuestionsPrompt,
  QUESTIONS_PROMPT_VERSION,
  questionsSchema,
  type Quiz,
  type QuizResult,
} from '../core/understand';
import { readBundled, readPatterns } from './bundled';
import { collectContext, readRules } from './context';
import type { Findings } from './findings';
import { CONFIG_PATH, type ProjectSettings } from './settings';
import type { UsageTracker } from './usage';
import type { Consent } from './consent';

/** Не получилось: нельзя отправлять (message — для статус-бара) или сбой модели и сети. */
type NotDone =
  { kind: 'refused'; message: string } | { kind: 'failed'; error: string; invalid: boolean };

/** Ответ модели по схеме и язык, на котором она отвечала. */
export type Asked<T> = { kind: 'done'; data: T; language: AdviceLanguage } | NotDone;

export type ExerciseOutcome =
  { kind: 'generated'; exercise: Exercise; language: AdviceLanguage } | NotDone;

export type CheckOutcome = { kind: 'checked'; understood: boolean; feedback: string } | NotDone;

const fixConfig = (error: string) => vscode.l10n.t('fix {0}: {1}', CONFIG_PATH, error);

const testInProgress = () =>
  vscode.l10n.t('test in progress: Adviser is silent in this folder ({0})', CONFIG_PATH);

const textOf = (doc: vscode.TextDocument, range: LineRange) =>
  doc.getText(new vscode.Range(range.start, 0, range.end, doc.lineAt(range.end).text.length));

export type Outcome =
  | { kind: 'reviewed'; review: Review; cached: boolean; presentation: Presentation }
  /**
   * Разбирать нельзя: провайдер не настроен, файл не отправляется или модель отказала (нет
   * доступа, исчерпан лимит). message — для статус-бара.
   */
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
      if (e instanceof ProviderRefusal) {
        this.log.warn(refusalText(e));
        return { kind: 'refused', message: e.message };
      }
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
    const code = textOf(doc, range);
    const settings = this.allowed(doc);
    if (typeof settings === 'string') {
      return { kind: 'refused', message: settings };
    }
    const asked = await this.ask({
      what: `проверка ответа: ${issue.patternId}`,
      version: CHECK_PROMPT_VERSION,
      schema: checkSchema,
      settings,
      sendsCode: true,
      build: (template, language) =>
        buildCheckPrompt(template, {
          languageId: doc.languageId,
          code,
          level: settings.level,
          language,
          issue,
          answer,
        }),
    });
    if (asked.kind !== 'done') {
      return asked;
    }
    const { understood } = asked.data;
    let { feedback } = asked.data;
    // Отзыв на неверный ответ — новый вопрос, а не решение: если выдаёт решение, заменяем.
    const leak = !understood && hintLeak(feedback, issue.fix.code, code);
    if (leak) {
      this.log.info(`${issue.patternId}: отзыв выдавал ответ («${leak}»), заменён`);
      feedback = checkFallback(asked.language);
    }
    this.log.info(`${issue.patternId}: ${understood ? 'объяснил верно' : 'пока не понял'}`);
    return { kind: 'checked', understood, feedback: applyCourseText(feedback, settings.course) };
  }

  /**
   * Упражнение на тип ошибки (src/core/exercise.ts). Кода учащегося в запросе нет, поэтому
   * согласия на отправку кода не нужно; бюджет — как у разбора.
   */
  async exercise(
    pattern: Pattern,
    languageId: string,
    uri: vscode.Uri | undefined,
  ): Promise<ExerciseOutcome> {
    const settings = this.settings.get(uri);
    const asked = await this.ask({
      what: `упражнение: ${pattern.id}, ${languageId}`,
      version: EXERCISE_PROMPT_VERSION,
      schema: exerciseSchema,
      settings,
      sendsCode: false,
      build: (template, language) =>
        buildExercisePrompt(template, { pattern, languageId, level: settings.level, language }),
    });
    return asked.kind === 'done'
      ? { kind: 'generated', exercise: asked.data, language: asked.language }
      : asked;
  }

  /** «Понимаю ли я изменения»: вопросы по изменениям (src/core/understand.ts). */
  async quizQuestions(diff: string, uri: vscode.Uri | undefined): Promise<Asked<Quiz>> {
    const settings = this.quizSettings(uri);
    if (typeof settings === 'string') {
      return { kind: 'refused', message: settings };
    }
    return this.ask({
      what: 'вопросы по изменениям',
      version: QUESTIONS_PROMPT_VERSION,
      schema: questionsSchema,
      settings,
      sendsCode: true,
      build: (template, language) =>
        buildQuestionsPrompt(template, { diff, level: settings.level, language }),
    });
  }

  /** Оценка ответов на вопросы по изменениям. */
  async quizAnswers(
    diff: string,
    quiz: Quiz,
    answers: string[],
    uri: vscode.Uri | undefined,
  ): Promise<Asked<QuizResult[]>> {
    const settings = this.quizSettings(uri);
    if (typeof settings === 'string') {
      return { kind: 'refused', message: settings };
    }
    const asked = await this.ask({
      what: 'ответы на вопросы по изменениям',
      version: ANSWERS_PROMPT_VERSION,
      schema: answersSchema,
      settings,
      sendsCode: true,
      build: (template, language) =>
        buildAnswersPrompt(template, { diff, quiz, answers, level: settings.level, language }),
    });
    return asked.kind === 'done' ? { ...asked, data: asked.data.answers } : asked;
  }

  /** Можно ли отправить этот файл модели — для изменений, которые собирает «Понимаю ли я». */
  sendable(doc: vscode.TextDocument): boolean {
    return typeof this.allowed(doc) !== 'string';
  }

  /** Настройки папки, где смотрят изменения: битый конфиг и контрольная останавливают и это. */
  private quizSettings(uri: vscode.Uri | undefined): Settings | string {
    const settings = this.settings.get(uri);
    if (settings.configError) {
      return fixConfig(settings.configError);
    }
    if (settings.course.silent) {
      return testInProgress();
    }
    return settings;
  }

  /**
   * Запрос со своим промптом и схемой: провайдер, бюджет, согласие (если уходит код), маскировка
   * секретов, повтор на ответ не по схеме. Ошибки — без всплывающих окон, в лог.
   */
  private async ask<T>(task: {
    what: string;
    version: string;
    schema: z.ZodType<T>;
    settings: Settings;
    sendsCode: boolean;
    build: (template: PromptTemplate, language: AdviceLanguage) => ModelRequest;
  }): Promise<Asked<T>> {
    try {
      const main = await createProvider(this.context);
      if (typeof main === 'string') {
        return { kind: 'refused', message: main };
      }
      const budget = this.withinBudget(main);
      if (typeof budget === 'string') {
        return { kind: 'refused', message: budget };
      }
      const denied = task.sendsCode && (await this.denied(budget.configured, true));
      if (denied) {
        return { kind: 'refused', message: denied };
      }
      const template = parseTemplate(
        await readBundled(this.context, 'prompts', `${task.version}.md`),
      );
      const language = resolveLanguage(task.settings.language, vscode.env.language);
      const built = task.build(template, language);
      const request = {
        ...built,
        system: redact(built.system).text,
        prompt: redact(built.prompt).text,
      };
      this.log.info(`${task.what}, ${task.version}`);
      const result = await runStructured(
        task.schema,
        budget.configured.provider,
        request,
        undefined,
        budget.spend,
      );
      if (!result.ok) {
        this.log.warn(result.error);
        return { kind: 'failed', error: result.error, invalid: result.invalid };
      }
      return { kind: 'done', data: result.data, language };
    } catch (e) {
      if (e instanceof ProviderRefusal) {
        this.log.warn(`${task.what}: ${refusalText(e)}`);
        return { kind: 'refused', message: e.message };
      }
      this.log.error(
        `${task.what}: не получилось: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
      );
      return { kind: 'failed', error: String(e), invalid: false };
    }
  }

  /** Можно ли отправлять этот файл. Строка — почему нельзя. */
  private allowed(doc: vscode.TextDocument): Settings | string {
    if (isEnvFile(doc.uri.fsPath)) {
      return vscode.l10n.t('.env* files are never sent');
    }
    const settings = this.settings.get(doc.uri);
    if (settings.configError) {
      return fixConfig(settings.configError);
    }
    if (settings.course.silent) {
      return testInProgress();
    }
    if (this.settings.ignored(doc, settings)) {
      return vscode.l10n.t('the file is in ignore of {0}, not sending it', CONFIG_PATH);
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
      return vscode.l10n.t('{0}, reviews are paused (adviser.budget settings)', over);
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
      return vscode.l10n.t(
        'permission to send code is needed: run "Adviser: Review This Function"',
      );
    }
    return (await this.consent.ask(configured.destination))
      ? undefined
      : vscode.l10n.t('sending code is not allowed');
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

/** Для лога: наша причина и то, что сказал сам провайдер. */
const refusalText = (e: ProviderRefusal) =>
  e.cause instanceof Error ? `${e.message} (${e.cause.message})` : e.message;

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
