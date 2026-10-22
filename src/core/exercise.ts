import { z } from 'zod';
import type { ModelRequest } from './engine';
import type { JournalEntry, PatternCount } from './journal';
import { fitsLanguage, OTHER_PATTERN, primaryLanguage, type Pattern } from './patterns';
import {
  fillTemplate,
  type AdviceLanguage,
  type Level,
  type PromptTemplate,
} from './promptBuilder';
import { AUTOPILOT_LANGUAGES } from './scheduler';

/**
 * Упражнение на слабое место: модель пишет новую короткую функцию с ошибкой выбранного типа,
 * учащийся ищет и исправляет её сам. Кода учащегося в запросе нет — только тип ошибки и язык.
 */

/** Версия промпта упражнения. Изменённый промпт — новый файл prompts/exercise.vN.md. */
export const EXERCISE_PROMPT_VERSION = 'exercise.v1';

export const exerciseSchema = z.object({
  /** Что должна делать функция — одно-два предложения, как в условии учебной задачи. */
  task: z.string(),
  /** Функция с одной ошибкой этого типа, без комментариев, которые её выдают. */
  code: z.string(),
});

export type Exercise = z.infer<typeof exerciseSchema>;

export const exerciseJsonSchema = z.toJSONSchema(exerciseSchema, { target: 'draft-7' }) as Record<
  string,
  unknown
>;

export interface ExerciseInput {
  pattern: Pattern;
  languageId: string;
  level: Level;
  language: AdviceLanguage;
}

export function buildExercisePrompt(template: PromptTemplate, input: ExerciseInput): ModelRequest {
  const { pattern, language } = input;
  return {
    system: fillTemplate(template, { level: input.level, language }),
    prompt: `Язык программирования: ${input.languageId}\n\nТип ошибки: ${pattern.id} — ${pattern.title[language]}\n`,
    jsonSchema: exerciseJsonSchema,
  };
}

export interface ExerciseChoice {
  pattern: Pattern;
  /** Сколько раз за три недели: у частых ошибок учащегося. */
  count?: number;
}

/**
 * Что можно потренировать: сначала частые ошибки учащегося (learnerProfile), потом остальные
 * типы языка открытого файла. other — не тип ошибки, его не тренируют.
 */
export function exerciseChoices(
  patterns: readonly Pattern[],
  profile: readonly PatternCount[],
  languageId: string,
): ExerciseChoice[] {
  const top = profile.flatMap((p): ExerciseChoice[] => {
    const pattern = patterns.find((q) => q.id === p.patternId);
    return pattern ? [{ pattern, count: p.count }] : [];
  });
  const rest = patterns
    .filter(
      (p) =>
        p.id !== OTHER_PATTERN &&
        fitsLanguage(p, languageId) &&
        !top.some((t) => t.pattern.id === p.id),
    )
    .map((pattern) => ({ pattern }));
  return [...top, ...rest];
}

/**
 * Язык упражнения: тот, в котором учащийся чаще всего делал эту ошибку, иначе — язык открытого
 * файла, если ошибка в нём бывает, иначе — основной язык типа ошибки.
 */
export function exerciseLanguage(
  entries: readonly JournalEntry[],
  pattern: Pattern,
  current: string | undefined,
): string {
  const usable = (languageId: string) =>
    AUTOPILOT_LANGUAGES.includes(languageId) && fitsLanguage(pattern, languageId);
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.patternId === pattern.id && usable(e.languageId)) {
      counts.set(e.languageId, (counts.get(e.languageId) ?? 0) + 1);
    }
  }
  const frequent = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return frequent ?? (current && usable(current) ? current : primaryLanguage(pattern));
}

/** Текст нового файла: условие комментарием сверху, на языке советов, как и само условие. */
export function exerciseText(
  exercise: Exercise,
  pattern: Pattern,
  languageId: string,
  language: AdviceLanguage,
): string {
  const mark = languageId === 'python' ? '#' : '//';
  const lines =
    language === 'ru'
      ? [
          `Упражнение Adviser: ${pattern.title.ru}.`,
          ...wrap(exercise.task.trim(), 90),
          'В функции есть такая ошибка. Найди и исправь её, а потом проверь себя:',
          '«Adviser: Разобрать эту функцию».',
        ]
      : [
          `Adviser exercise: ${pattern.title.en}.`,
          ...wrap(exercise.task.trim(), 90),
          'The function has this mistake. Find and fix it, then check yourself with',
          '"Adviser: Review This Function".',
        ];
  return `${lines.map((l) => `${mark} ${l}`).join('\n')}\n\n${exercise.code.trim()}\n`;
}

/** Перенос по словам: длинное условие в одну строку читать неудобно. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  return line ? [...lines, line] : lines;
}
