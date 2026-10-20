import { z } from 'zod';
import { MAX_ISSUES } from './engine';
import { ADVICE_LANGUAGES, LEVELS, type Level } from './promptBuilder';
import { CATEGORIES, SEVERITIES, type Issue, type Severity } from './reviewSchema';
import { MENTOR_LIMITS, MODES, type Limits, type Mode } from './scheduler';

/**
 * .adviser/config.json — настройки проекта (6.7 плана), лежат в git. Провайдера, адреса сервера
 * и модели здесь нет и не будет: иначе чужой репозиторий увёл бы код и ключ на свой сервер.
 */
export const projectConfigSchema = z
  .object({
    mode: z
      .enum(MODES)
      .optional()
      .describe(
        'Когда разбирать: mentor — сам, manual — только по команде. Проект может выключить автопилот, но не включить его тому, кто выбрал manual.',
      ),
    level: z
      .enum(LEVELS)
      .optional()
      .describe('Уровень учащегося: beginner, intermediate или advanced.'),
    language: z
      .enum(['auto', ...ADVICE_LANGUAGES])
      .optional()
      .describe('Язык советов: auto — по языку интерфейса VS Code.'),
    triggers: z
      .object({
        onSave: z.boolean().optional().describe('Разбирать при сохранении вручную.'),
        onLeaveFunction: z
          .boolean()
          .optional()
          .describe('Разбирать, когда курсор уходит из изменённой функции.'),
        idleSeconds: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Разбирать после паузы в наборе, секунд. 0 — не разбирать по паузе.'),
      })
      .optional(),
    limits: z
      .object({
        perHour: z.number().int().min(0).optional(),
        perDay: z.number().int().min(0).optional(),
        cooldownMinutes: z
          .number()
          .min(0)
          .optional()
          .describe('Не разбирать одну функцию чаще, минут.'),
        maxIssuesPerBlock: z
          .number()
          .int()
          .min(1)
          .max(MAX_ISSUES)
          .optional()
          .describe('Сколько замечаний на функцию показывать.'),
      })
      .optional()
      .describe(
        'Лимиты разборов. Проект может только ужесточить их: чужой репозиторий не должен тратить твои запросы.',
      ),
    minSeverity: z
      .enum(SEVERITIES)
      .optional()
      .describe(
        'Самая лёгкая серьёзность, которую показывать: critical, warning или suggestion (все).',
      ),
    categories: z
      .partialRecord(z.enum(CATEGORIES), z.boolean())
      .optional()
      .describe('false — не показывать замечания этой категории.'),
    readAgentFiles: z
      .boolean()
      .optional()
      .describe(
        'Добавлять к правилам из .adviser/rules.md файлы для ИИ-агентов: AGENTS.md, CLAUDE.md, .cursorrules, .github/copilot-instructions.md. По умолчанию нет.',
      ),
    ignore: z
      .array(z.string())
      .optional()
      .describe(
        'Glob-шаблоны файлов от корня проекта, которые Adviser не отправляет: ["generated/**"].',
      ),
  })
  .meta({ title: 'Adviser: настройки проекта' });

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/** Разбор .adviser/config.json. Ошибка — строка для лога: файл пишет человек, он мог ошибиться. */
export function parseProjectConfig(text: string): { config?: ProjectConfig; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: `не JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = projectConfigSchema.safeParse(raw);
  return parsed.success
    ? { config: parsed.data }
    : { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}

export interface Triggers {
  onSave: boolean;
  onLeaveFunction: boolean;
  /** 0 — по паузе не разбирать. */
  pauseMs: number;
}

/** Настройки из VS Code: режим, уровень и язык советов. */
export interface UserSettings {
  mode: Mode;
  level: Level;
  /** auto, ru или en — как в adviser.language. */
  language: string;
  /** Типы ошибок, о которых человек попросил больше не говорить (adviser.hiddenPatterns). */
  hiddenPatterns: string[];
}

export interface Settings extends UserSettings {
  triggers: Triggers;
  limits: Limits;
  maxIssues: number;
  minSeverity: Severity;
  hiddenCategories: string[];
  ignore: string[];
  readAgentFiles: boolean;
  /** Какие настройки взяты из проекта — подсказка для статус-бара. */
  fromProject: string[];
}

export const DEFAULT_TRIGGERS: Triggers = { onSave: true, onLeaveFunction: true, pauseMs: 30_000 };

/**
 * Три слоя: умолчания → настройки VS Code → .adviser/config.json. Проект перекрывает
 * пользователя, но лимиты и режим может только ужесточить.
 */
export function mergeSettings(user: UserSettings, project: ProjectConfig = {}): Settings {
  const limits = project.limits ?? {};
  const triggers = project.triggers ?? {};
  return {
    mode: user.mode === 'manual' ? 'manual' : (project.mode ?? user.mode),
    level: project.level ?? user.level,
    language: project.language ?? user.language,
    hiddenPatterns: user.hiddenPatterns,
    triggers: {
      onSave: triggers.onSave ?? DEFAULT_TRIGGERS.onSave,
      onLeaveFunction: triggers.onLeaveFunction ?? DEFAULT_TRIGGERS.onLeaveFunction,
      pauseMs:
        triggers.idleSeconds === undefined ? DEFAULT_TRIGGERS.pauseMs : triggers.idleSeconds * 1000,
    },
    limits: {
      ...MENTOR_LIMITS,
      cooldownMs: Math.max(MENTOR_LIMITS.cooldownMs, (limits.cooldownMinutes ?? 0) * 60_000),
      perHour: Math.min(MENTOR_LIMITS.perHour, limits.perHour ?? Infinity),
      perDay: Math.min(MENTOR_LIMITS.perDay, limits.perDay ?? Infinity),
    },
    maxIssues: Math.min(MAX_ISSUES, limits.maxIssuesPerBlock ?? MAX_ISSUES),
    minSeverity: project.minSeverity ?? 'suggestion',
    hiddenCategories: CATEGORIES.filter((c) => project.categories?.[c] === false),
    ignore: [...(project.ignore ?? [])],
    readAgentFiles: project.readAgentFiles ?? false,
    fromProject: Object.keys(project),
  };
}

/**
 * Замечания, которые не показываем: легче minSeverity, скрытые проектом категории,
 * скрытые человеком типы ошибок и всё сверх лимита.
 */
export function filterIssues(issues: Issue[], settings: Settings): Issue[] {
  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  return issues
    .filter(
      (i) =>
        rank(i.severity) <= rank(settings.minSeverity) &&
        !settings.hiddenCategories.includes(i.category) &&
        !settings.hiddenPatterns.includes(i.patternId),
    )
    .slice(0, settings.maxIssues);
}
