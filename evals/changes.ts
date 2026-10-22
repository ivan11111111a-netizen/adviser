// Eval «Понимаю ли я изменения» (9.12): модель задаёт вопросы по изменению, потом оценивает
// ответы. Правильный ответ — тот, что дала сама модель; неверные — «не знаю» и ответ на другой
// вопрос. Хорошо, если правильные засчитаны, а неверные — нет.
import { z } from 'zod';
import type { Quiz, QuizResult } from '../src/core/understand';

const changesCaseSchema = z.object({
  name: z.string(),
  /** Имя файла: по нему видно язык. */
  file: z.string(),
  /** Пусто — файл новый. */
  before: z.string(),
  after: z.string(),
});

export type ChangesCase = z.infer<typeof changesCaseSchema>;

export function parseChangesCases(raw: unknown): ChangesCase[] {
  return z.object({ cases: z.array(changesCaseSchema).min(1) }).parse(raw).cases;
}

/** Набор ответов и какой оценки от модели ждём. */
export type AnswerKind = 'expected' | 'dontKnow' | 'swapped';

export interface ChangesRecord {
  name: string;
  quiz?: Quiz;
  /** Оценки по видам ответов. */
  results: Partial<Record<AnswerKind, QuizResult[]>>;
  error?: string;
}

/** Ответы каждого вида: правильные, «не знаю», правильные от соседнего вопроса. */
export function answerSets(quiz: Quiz): Partial<Record<AnswerKind, string[]>> {
  const expected = quiz.questions.map((q) => q.answer);
  const sets: Partial<Record<AnswerKind, string[]>> = {
    expected,
    dontKnow: expected.map(() => 'не знаю'),
  };
  if (expected.length >= 2) {
    sets.swapped = expected.map((_, i) => expected[(i + 1) % expected.length]);
  }
  return sets;
}

export interface ChangesSummary {
  cases: number;
  failed: number;
  questions: number;
  /** Правильных ответов засчитано / всего. */
  accepted: [number, number];
  /** «Не знаю» не засчитано / всего. */
  dontKnowRejected: [number, number];
  /** Ответ на другой вопрос не засчитан / всего. */
  swappedRejected: [number, number];
}

export function summarizeChanges(records: readonly ChangesRecord[]): ChangesSummary {
  const count = (kind: AnswerKind, want: boolean): [number, number] => {
    const all = records.flatMap((r) => r.results[kind] ?? []);
    return [all.filter((x) => x.understood === want).length, all.length];
  };
  return {
    cases: records.length,
    failed: records.filter((r) => r.error).length,
    questions: records.reduce((n, r) => n + (r.quiz?.questions.length ?? 0), 0),
    accepted: count('expected', true),
    dontKnowRejected: count('dontKnow', false),
    swappedRejected: count('swapped', false),
  };
}

const ratio = ([a, b]: [number, number]) => `${a} из ${b}`;

export function renderChangesReport(
  meta: { id: string; date: string; model: string; prompts: string },
  records: readonly ChangesRecord[],
): string {
  const s = summarizeChanges(records);
  const lines = [
    `# Eval «Понимаю ли я изменения»: ${meta.id}`,
    '',
    `${meta.date}, модель ${meta.model}, промпты ${meta.prompts}.`,
    '',
    '| Метрика | Значение |',
    '|---|---|',
    `| Вопросов | ${s.questions} на ${s.cases - s.failed} изменений |`,
    `| Правильный ответ засчитан | ${ratio(s.accepted)} |`,
    `| «Не знаю» не засчитано | ${ratio(s.dontKnowRejected)} |`,
    `| Ответ на другой вопрос не засчитан | ${ratio(s.swappedRejected)} |`,
    `| Не получилось | ${s.failed} |`,
    '',
  ];
  for (const r of records) {
    lines.push(`## ${r.name}`, '');
    if (r.error || !r.quiz) {
      lines.push(`Ошибка: ${r.error}`, '');
      continue;
    }
    lines.push(`**Что делает изменение.** ${r.quiz.summary}`, '');
    r.quiz.questions.forEach((q, i) => {
      const marks = (['expected', 'dontKnow', 'swapped'] as const)
        .map((kind) => {
          const result = r.results[kind]?.find((x) => x.index === i);
          return result ? `${kind}: ${result.understood ? 'засчитан' : 'нет'}` : undefined;
        })
        .filter(Boolean)
        .join(', ');
      lines.push(`${i + 1}. ${q.question} — _${q.answer}_ (${marks})`);
    });
    lines.push('');
  }
  return lines.join('\n');
}
