import { z } from 'zod';
import type { ModelRequest } from './engine';
import {
  fillTemplate,
  numberLines,
  type AdviceLanguage,
  type Level,
  type PromptTemplate,
} from './promptBuilder';
import type { Issue } from './reviewSchema';

/**
 * «Проверь меня»: учащийся своими словами объясняет, в чём ошибка, а модель сверяет его ответ
 * с объяснением из разбора. Объяснить самому — лучшая проверка, что правило усвоено.
 */

/** Версия промпта проверки. Изменённый промпт — новый файл prompts/check.vN.md. */
export const CHECK_PROMPT_VERSION = 'check.v1';

/** Ответ длиннее обрезается: объяснение ошибки — пара фраз, а не сочинение. */
export const MAX_ANSWER = 1000;

export const checkSchema = z.object({
  /** Учащийся назвал настоящую причину ошибки, пусть своими словами и не полностью. */
  understood: z.boolean(),
  /** Одна-две фразы учащемуся: что верно, а если не понял — вопрос, который подводит ближе. */
  feedback: z.string(),
});

export type CheckResult = z.infer<typeof checkSchema>;

export const checkJsonSchema = z.toJSONSchema(checkSchema, { target: 'draft-7' }) as Record<
  string,
  unknown
>;

export interface CheckInput {
  languageId: string;
  /** Функция с замечанием. */
  code: string;
  level: Level;
  language: AdviceLanguage;
  /** Замечание: строки от начала функции, намёк, который видел учащийся, и объяснение — эталон. */
  issue: Pick<Issue, 'startLine' | 'endLine' | 'hint' | 'explanation'>;
  answer: string;
}

/** Теги запроса внутри текстов: ответ учащегося не должен закрыть <answer> и дописать своё. */
const TAGS = /<\/?\s*(code|issue|hint|reference|answer)\b[^>]*>/gi;

const clean = (text: string) => text.replace(TAGS, '').trim();

/** Инструкция — в system, а код, замечание и ответ учащегося — данные в тегах. */
export function buildCheckPrompt(template: PromptTemplate, input: CheckInput): ModelRequest {
  const { issue } = input;
  const answer = clean(input.answer).slice(0, MAX_ANSWER);
  return {
    system: fillTemplate(template, { level: input.level, language: input.language }),
    prompt: [
      `Язык программирования: ${input.languageId}`,
      '',
      `<code>\n${numberLines(input.code)}\n</code>`,
      '',
      `<issue lines="${issue.startLine}-${issue.endLine}">`,
      `<hint>${clean(issue.hint)}</hint>`,
      `<reference>${clean(issue.explanation)}</reference>`,
      '</issue>',
      '',
      `<answer>\n${answer}\n</answer>`,
      '',
    ].join('\n'),
    jsonSchema: checkJsonSchema,
  };
}

/** Если отзыв на неверный ответ выдаёт решение, вместо него — этот. */
export function checkFallback(language: AdviceLanguage): string {
  return language === 'ru'
    ? 'Пока не то. Перечитай вопрос в подсказке и посмотри на эти строки ещё раз.'
    : 'Not quite. Reread the question in the hint and look at these lines again.';
}
