// Eval «Проверь меня» (9.8): верно ли модель решает, понял ли учащийся ошибку, и не выдаёт ли
// ответ, когда не понял. Набор — evals/check-cases.json: замечание готовое, ответы учащегося
// написаны заранее вместе с правильной оценкой.
import { z } from 'zod';
import { LEVELS } from '../src/core/promptBuilder';

const checkCaseSchema = z.object({
  /** Путь от evals/cases/: те же учебные функции, что и в наборе разборов. */
  file: z.string(),
  level: z.enum(LEVELS).optional(),
  issue: z.object({
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    hint: z.string(),
    explanation: z.string(),
    /** Исправленный код: по нему видно, не выдал ли отзыв решение (hintLeak). */
    fix: z.string(),
  }),
  answers: z.array(z.object({ text: z.string().min(1), understood: z.boolean() })).min(1),
});

export type CheckCase = z.infer<typeof checkCaseSchema>;

export function parseCheckCases(raw: unknown): CheckCase[] {
  return z.object({ cases: z.array(checkCaseSchema) }).parse(raw).cases;
}

export interface CheckRecord {
  file: string;
  answer: string;
  expected: boolean;
  seconds: number;
  got?: boolean;
  feedback?: string;
  /** Что из решения назвал отзыв на неверный ответ. */
  leak?: string;
  error?: string;
}

export interface CheckSummary {
  total: number;
  failed: number;
  correct: number;
  /** Сказала «верно» на неверный ответ — хуже всего: учащийся уйдёт с ошибкой в голове. */
  falseAccepts: number;
  /** Сказала «не то» на верный ответ — обидно, но учащийся откроет объяснение и сверит. */
  falseRejects: number;
  /** Отзывов на неверный ответ и сколько из них выдают решение. */
  rejected: number;
  leaks: number;
  medianSeconds: number;
}

export function summarizeChecks(records: readonly CheckRecord[]): CheckSummary {
  const answered = records.filter((r) => r.got !== undefined);
  const seconds = records.map((r) => r.seconds).sort((a, b) => a - b);
  const rejected = answered.filter((r) => !r.got);
  return {
    total: records.length,
    failed: records.length - answered.length,
    correct: answered.filter((r) => r.got === r.expected).length,
    falseAccepts: answered.filter((r) => r.got && !r.expected).length,
    falseRejects: answered.filter((r) => !r.got && r.expected).length,
    rejected: rejected.length,
    leaks: rejected.filter((r) => r.leak).length,
    medianSeconds: seconds.length ? seconds[Math.floor(seconds.length / 2)] : 0,
  };
}

const percent = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ');

/** Отчёт в Markdown: метрики, ошибки оценки и все отзывы — их стоит перечитать глазами. */
export function renderCheckReport(
  meta: { id: string; date: string; model: string; prompt: string },
  records: readonly CheckRecord[],
): string {
  const s = summarizeChecks(records);
  const answered = s.total - s.failed;
  const lines = [
    `# Eval «Проверь меня»: ${meta.id}`,
    '',
    `${meta.date}, модель ${meta.model}, промпт ${meta.prompt}.`,
    '',
    '| Метрика | Значение |',
    '|---|---|',
    `| Оценка верна | ${s.correct} из ${answered} (${percent(s.correct, answered)}) |`,
    `| «Верно» на неверный ответ | ${s.falseAccepts} |`,
    `| «Не то» на верный ответ | ${s.falseRejects} |`,
    `| Отзыв на неверный ответ выдаёт решение (эвристика) | ${s.leaks} из ${s.rejected} |`,
    `| Не ответила | ${s.failed} |`,
    `| Медиана, с | ${s.medianSeconds.toFixed(1)} |`,
    '',
    '## Все ответы',
    '',
    '| Файл | Ответ учащегося | Ждали | Модель | Отзыв |',
    '|---|---|---|---|---|',
  ];
  const mark = (v?: boolean) => (v === undefined ? '—' : v ? 'понял' : 'не понял');
  for (const r of records) {
    const wrong = r.got !== undefined && r.got !== r.expected ? ' **✗**' : '';
    const feedback = r.error
      ? `ошибка: ${r.error}`
      : `${r.feedback ?? ''}${r.leak ? ` _(выдаёт «${r.leak}»)_` : ''}`;
    lines.push(
      `| ${r.file} | ${cell(r.answer)} | ${mark(r.expected)} | ${mark(r.got)}${wrong} | ${cell(feedback)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
