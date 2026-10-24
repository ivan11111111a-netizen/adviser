import { z } from 'zod';
import type { CourseRules } from './course';
import { MAX_ISSUES } from './engine';
import { ADVICE_LANGUAGES, LEVELS, type Level } from './promptBuilder';
import { CATEGORIES, SEVERITIES, type Issue, type Severity } from './reviewSchema';
import { MENTOR_LIMITS, MODES, REVIEWER_LIMITS, type Limits, type Mode } from './scheduler';

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
        'When to review: mentor — on its own, manual — only on command. A project can turn the autopilot off but cannot turn it on for someone who chose manual.',
      ),
    level: z
      .enum(LEVELS)
      .optional()
      .describe('The learner level: beginner, intermediate or advanced.'),
    language: z
      .enum(['auto', ...ADVICE_LANGUAGES])
      .optional()
      .describe('Advice language: auto — by the VS Code display language.'),
    triggers: z
      .object({
        onSave: z.boolean().optional().describe('Review on manual save.'),
        onLeaveFunction: z
          .boolean()
          .optional()
          .describe('Review when the cursor leaves a changed function.'),
        idleSeconds: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Review after a typing pause, seconds. 0 — no review on pause.'),
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
          .describe('Do not review the same function more often than this, minutes.'),
        maxIssuesPerBlock: z
          .number()
          .int()
          .min(1)
          .max(MAX_ISSUES)
          .optional()
          .describe('How many issues to show per function.'),
      })
      .optional()
      .describe(
        'Review limits. A project can only make them stricter: a repository you cloned must not spend your requests.',
      ),
    minSeverity: z
      .enum(SEVERITIES)
      .optional()
      .describe('The mildest severity to show: critical, warning or suggestion (all).'),
    categories: z
      .partialRecord(z.enum(CATEGORIES), z.boolean())
      .optional()
      .describe('false — do not show issues of this category.'),
    course: z
      .object({
        silent: z
          .boolean()
          .optional()
          .describe('Test in progress: Adviser is silent in this folder, even on command.'),
        hideSolutions: z
          .boolean()
          .optional()
          .describe('Do not show the ready solution: only the hint and the explanation.'),
        forbidden: z
          .array(z.string())
          .optional()
          .describe(
            'Words Adviser does not say in this assignment: they are cut from the texts, and a solution containing them is hidden.',
          ),
      })
      .optional()
      .describe('Course rules from the teacher.'),
    readAgentFiles: z
      .boolean()
      .optional()
      .describe(
        'Add files for AI agents to the rules from .adviser/rules.md: AGENTS.md, CLAUDE.md, .cursorrules, .github/copilot-instructions.md. Off by default.',
      ),
    ignore: z
      .array(z.string())
      .optional()
      .describe(
        'Glob patterns of files, from the project root, that Adviser does not send: ["generated/**"].',
      ),
  })
  .meta({ title: 'Adviser: project settings' });

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/** Разбор .adviser/config.json. Ошибка — строка для лога: файл пишет человек, он мог ошибиться. */
export function parseProjectConfig(text: string): { config?: ProjectConfig; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    // Сообщение JSON.parse — английское, как и у zod ниже: это технические подробности.
    return { error: `not JSON: ${e instanceof Error ? e.message : String(e)}` };
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
  course: CourseRules;
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
  const mode = user.mode === 'manual' ? 'manual' : (project.mode ?? user.mode);
  // «Ревьюер» по паузе не разбирает и вмешивается реже (6.2 плана).
  const base = mode === 'reviewer' ? REVIEWER_LIMITS : MENTOR_LIMITS;
  const pauseMs = mode === 'reviewer' ? 0 : DEFAULT_TRIGGERS.pauseMs;
  return {
    mode,
    level: project.level ?? user.level,
    language: project.language ?? user.language,
    hiddenPatterns: user.hiddenPatterns,
    triggers: {
      onSave: triggers.onSave ?? DEFAULT_TRIGGERS.onSave,
      onLeaveFunction: triggers.onLeaveFunction ?? DEFAULT_TRIGGERS.onLeaveFunction,
      pauseMs: triggers.idleSeconds === undefined ? pauseMs : triggers.idleSeconds * 1000,
    },
    limits: {
      ...base,
      cooldownMs: Math.max(base.cooldownMs, (limits.cooldownMinutes ?? 0) * 60_000),
      perHour: Math.min(base.perHour, limits.perHour ?? Infinity),
      perDay: Math.min(base.perDay, limits.perDay ?? Infinity),
    },
    maxIssues: Math.min(MAX_ISSUES, limits.maxIssuesPerBlock ?? MAX_ISSUES),
    minSeverity: project.minSeverity ?? 'suggestion',
    hiddenCategories: CATEGORIES.filter((c) => project.categories?.[c] === false),
    ignore: [...(project.ignore ?? [])],
    readAgentFiles: project.readAgentFiles ?? false,
    course: {
      silent: project.course?.silent ?? false,
      hideSolutions: project.course?.hideSolutions ?? false,
      forbidden: [...(project.course?.forbidden ?? [])],
    },
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
