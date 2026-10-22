import { z } from 'zod';
import { LEVELS } from '../src/core/promptBuilder';

const expectedSchema = z.object({
  /** Какие patternId засчитываются: тип ошибки бывает спорным (пустой список или деление на ноль). */
  patterns: z.array(z.string()).min(1),
  /** Строки файла с 1, включительно. Замечание засчитывается, если задевает их (с запасом в строку). */
  lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
});

const caseSchema = z.object({
  /** Путь от evals/cases/. Файл целиком уходит модели как одна функция, поэтому в нём нет подсказок. */
  file: z.string(),
  level: z.enum(LEVELS).optional(),
  /** Пусто — чистый код: правильный ответ — «замечаний нет». */
  expect: z.array(expectedSchema),
  /** Замечания с этими patternId по делу, но не обязательны: шумом не считаются. */
  allow: z.array(z.string()).optional(),
});

export type ExpectedIssue = z.infer<typeof expectedSchema>;
export type EvalCase = z.infer<typeof caseSchema>;

export function parseCases(raw: unknown): EvalCase[] {
  return z.object({ cases: z.array(caseSchema) }).parse(raw).cases;
}

const LANGUAGE_IDS: Record<string, string> = {
  '.js': 'javascript',
  '.ts': 'typescript',
  '.py': 'python',
  '.c': 'c',
  '.cpp': 'cpp',
  '.java': 'java',
};

/** languageId VS Code по расширению файла — так же его видит расширение. */
export function languageIdOf(file: string): string | undefined {
  return LANGUAGE_IDS[file.slice(file.lastIndexOf('.'))];
}
