import { z } from 'zod';
import type { ModelRequest } from './engine';
import { untranslated, type Translate } from './i18n';
import {
  fillTemplate,
  type AdviceLanguage,
  type Level,
  type PromptTemplate,
} from './promptBuilder';

/**
 * «Понимаю ли я изменения»: код, который за учащегося написал ИИ-агент, легко принять не читая.
 * Модель задаёт вопросы по изменениям относительно последнего коммита, учащийся отвечает,
 * модель оценивает ответы.
 */

/** Версии промптов. Изменённый промпт — новый файл с новой версией. */
export const QUESTIONS_PROMPT_VERSION = 'changes.v1';
export const ANSWERS_PROMPT_VERSION = 'changes-check.v1';

/** Сколько строк изменений уходит модели: больше учащийся всё равно не прочтёт за раз. */
export const MAX_DIFF_LINES = 400;
export const MAX_QUESTIONS = 3;
/** Ответ длиннее обрезается, как и в «Проверь меня». */
export const MAX_ANSWER = 1000;

export const questionsSchema = z.object({
  /** Что делает изменение — учащийся увидит после ответов. */
  summary: z.string(),
  questions: z.array(
    z.object({
      question: z.string(),
      /** Файл, к которому вопрос относится. */
      file: z.string(),
      /** Правильный ответ: по нему проверяют ответ учащегося, его показывают в конце. */
      answer: z.string(),
    }),
  ),
});

export type Quiz = z.infer<typeof questionsSchema>;

export const answersSchema = z.object({
  answers: z.array(
    z.object({
      index: z.number().int().min(0),
      understood: z.boolean(),
      feedback: z.string(),
    }),
  ),
});

export type QuizResult = z.infer<typeof answersSchema>['answers'][number];

const toJsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;

export const questionsJsonSchema = toJsonSchema(questionsSchema);
export const answersJsonSchema = toJsonSchema(answersSchema);

export interface FileDiff {
  /** Путь от корня репозитория. */
  path: string;
  /** git diff файла; у нового файла — весь текст со знаком +. */
  diff: string;
}

/** Новый файл в виде diff: каждая строка добавлена. */
export const newFileDiff = (text: string) =>
  text
    .replace(/\r?\n$/, '')
    .split(/\r?\n/)
    .map((line) => `+${line}`)
    .join('\n');

/**
 * Изменения по файлам в одном тексте не длиннее maxLines строк. Файл, который не влезает
 * целиком, пропускается (кроме первого — от него берётся начало): полфайла сбивает с толку.
 */
export function fitDiffs(
  files: readonly FileDiff[],
  maxLines = MAX_DIFF_LINES,
): { text: string; included: string[]; skipped: string[] } {
  const parts: string[] = [];
  const included: string[] = [];
  const skipped: string[] = [];
  let used = 0;
  for (const file of files) {
    const lines = file.diff.trimEnd().split('\n');
    if (!file.diff.trim()) {
      continue;
    }
    if (used + lines.length > maxLines && included.length) {
      skipped.push(file.path);
      continue;
    }
    const kept = lines.slice(0, maxLines - used);
    parts.push(`### ${file.path}\n${kept.join('\n')}`);
    included.push(file.path);
    used += kept.length;
  }
  return { text: parts.join('\n\n'), included, skipped };
}

/** Теги запроса внутри текстов: изменения и ответы — данные, они не закрывают свои теги. */
const TAGS = /<\/?\s*(diff|qa|question|expected|answer)\b[^>]*>/gi;
const clean = (text: string) => text.replace(TAGS, '');

interface PromptBase {
  diff: string;
  level: Level;
  language: AdviceLanguage;
}

export function buildQuestionsPrompt(template: PromptTemplate, input: PromptBase): ModelRequest {
  return {
    system: fillTemplate(template, { level: input.level, language: input.language }),
    prompt: `<diff>\n${clean(input.diff)}\n</diff>\n`,
    jsonSchema: questionsJsonSchema,
  };
}

export function buildAnswersPrompt(
  template: PromptTemplate,
  input: PromptBase & { quiz: Quiz; answers: string[] },
): ModelRequest {
  const qa = input.quiz.questions.map((q, i) =>
    [
      `<question index="${i}">${clean(q.question)}</question>`,
      `<expected>${clean(q.answer)}</expected>`,
      `<answer>${clean(input.answers[i] ?? '')
        .trim()
        .slice(0, MAX_ANSWER)}</answer>`,
    ].join('\n'),
  );
  return {
    system: fillTemplate(template, { level: input.level, language: input.language }),
    prompt: `<diff>\n${clean(input.diff)}\n</diff>\n\n<qa>\n${qa.join('\n\n')}\n</qa>\n`,
    jsonSchema: answersJsonSchema,
  };
}

/** Отчёт после ответов: вопрос, ответ учащегося, оценка, правильный ответ. */
export function renderQuizReport(
  quiz: Quiz,
  answers: readonly string[],
  results: readonly QuizResult[],
  files: { included: string[]; skipped: string[] },
  t: Translate = untranslated,
): string {
  const right = results.filter((r) => r.understood).length;
  const lines = [
    t('# Adviser: do you understand the changes'),
    '',
    t(
      'Compared with the last commit, files: {0}. Correct: {1} of {2}.',
      files.included.length,
      right,
      quiz.questions.length,
    ),
    '',
  ];
  if (files.skipped.length) {
    lines.push(t('Left out (changes too long): {0}.', files.skipped.join(', ')), '');
  }
  lines.push(`${t('**What the change does.**')} ${quiz.summary}`, '');
  quiz.questions.forEach((q, i) => {
    const result = results.find((r) => r.index === i);
    const answer = answers[i]?.trim();
    lines.push(`## ${i + 1}. ${q.question}`, '', `_${q.file}_`, '');
    lines.push(
      `${t('**Your answer:**')} ${answer ? answer.replace(/\s+/g, ' ') : t('_skipped_')}`,
      '',
    );
    if (result) {
      lines.push(`${result.understood ? '✓' : t('**Not quite.**')} ${result.feedback}`, '');
    }
    lines.push(`${t("**Adviser's answer:**")} ${q.answer}`, '');
  });
  return lines.join('\n');
}
