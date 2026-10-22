// Eval упражнений (9.11): модель пишет функцию с ошибкой заданного типа, а потом тот же наставник,
// что и в расширении, её разбирает. Хорошее упражнение — ошибка нужного типа нашлась, других нет.
import { z } from 'zod';
import type { Issue } from '../src/core/reviewSchema';

const exerciseCaseSchema = z.object({
  pattern: z.string(),
  languageId: z.string(),
});

export type ExerciseCase = z.infer<typeof exerciseCaseSchema>;

export function parseExerciseCases(raw: unknown): ExerciseCase[] {
  return z.object({ cases: z.array(exerciseCaseSchema).min(1) }).parse(raw).cases;
}

export interface ExerciseRecord extends ExerciseCase {
  task?: string;
  code?: string;
  /** Замечания наставника на код упражнения. */
  issues?: Pick<Issue, 'patternId' | 'severity' | 'hint'>[];
  error?: string;
}

export interface ExerciseSummary {
  total: number;
  failed: number;
  /** Наставник нашёл ошибку того типа, на который упражнение. */
  found: number;
  /** Кроме заложенной ошибки, наставник нашёл другие (не suggestion): упражнение с лишним. */
  withExtra: number;
}

export const extraIssues = (r: ExerciseRecord) =>
  (r.issues ?? []).filter((i) => i.patternId !== r.pattern && i.severity !== 'suggestion');

export function summarizeExercises(records: readonly ExerciseRecord[]): ExerciseSummary {
  const done = records.filter((r) => r.issues);
  return {
    total: records.length,
    failed: records.length - done.length,
    found: done.filter((r) => r.issues!.some((i) => i.patternId === r.pattern)).length,
    withExtra: done.filter((r) => extraIssues(r).length).length,
  };
}

/** Отчёт: метрики и каждое упражнение целиком — их стоит прочитать глазами. */
export function renderExerciseReport(
  meta: { id: string; date: string; model: string; prompt: string; reviewPrompt: string },
  records: readonly ExerciseRecord[],
): string {
  const s = summarizeExercises(records);
  const done = s.total - s.failed;
  const lines = [
    `# Eval упражнений: ${meta.id}`,
    '',
    `${meta.date}, модель ${meta.model}, промпт ${meta.prompt}, разбирает ${meta.reviewPrompt}.`,
    '',
    '| Метрика | Значение |',
    '|---|---|',
    `| Ошибка нужного типа нашлась | ${s.found} из ${done} |`,
    `| Есть другие ошибки (не suggestion) | ${s.withExtra} из ${done} |`,
    `| Не получилось | ${s.failed} |`,
    '',
  ];
  for (const r of records) {
    const found = r.issues?.some((i) => i.patternId === r.pattern);
    lines.push(
      `## ${r.pattern}, ${r.languageId}${r.issues ? (found ? '' : ' — не нашлась') : ''}`,
      '',
    );
    if (r.error) {
      lines.push(`Ошибка: ${r.error}`, '');
      continue;
    }
    lines.push(`**Условие.** ${r.task}`, '', '```' + r.languageId, r.code ?? '', '```', '');
    const issues = r.issues ?? [];
    lines.push(
      issues.length
        ? `Наставник: ${issues.map((i) => `${i.patternId} (${i.severity})`).join(', ')}.`
        : 'Наставник: замечаний нет.',
      '',
    );
  }
  return lines.join('\n');
}
