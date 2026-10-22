import { hasHint } from '../src/core/disclosure';
// Судья намёков (этап 3): вторая модель проверяет, что hint наводит на проблему, но не выдаёт ответ.
import { z } from 'zod';
import { runStructured, type ModelRequest, type Provider } from '../src/core/engine';
import { numberLines } from '../src/core/promptBuilder';
import type { Issue } from '../src/core/reviewSchema';

export const JUDGE_PROMPT_VERSION = 'judge.v1';

const judgmentSchema = z.object({
  index: z.number().int().min(0),
  /** Намёк называет ошибку, говорит, что сделать, или содержит исправленный код. */
  leaks: z.boolean(),
  /** Подумав над намёком, учащийся найдёт проблему сам. */
  guides: z.boolean(),
  comment: z.string(),
});
const responseSchema = z.object({ hints: z.array(judgmentSchema) });

export type Judgment = z.infer<typeof judgmentSchema>;

const responseJsonSchema = z.toJSONSchema(responseSchema, { target: 'draft-7' }) as Record<
  string,
  unknown
>;

/** Номера замечаний, у которых учащийся видит намёк (hasHint): у уязвимостей его нет. */
export function judgedIndexes(issues: Issue[]): number[] {
  return issues.flatMap((issue, i) => (hasHint(issue) ? [i] : []));
}

/** Код и намёки с тем, что за ними стоит: без объяснения и решения судье не понять, выдан ли ответ. */
export function buildJudgeRequest(
  system: string,
  languageId: string,
  code: string,
  issues: Issue[],
): ModelRequest {
  const hints = judgedIndexes(issues).map((i) =>
    [
      `[${i}] Проблема: ${issues[i].explanation}`,
      `    Решение: ${issues[i].fix.description}`,
      `    Намёк: ${issues[i].hint}`,
    ].join('\n'),
  );
  return {
    system: system.trim(),
    prompt: `Язык программирования: ${languageId}\n\n<code>\n${numberLines(code)}\n</code>\n\n<hints>\n${hints.join('\n')}\n</hints>\n`,
    jsonSchema: responseJsonSchema,
  };
}

export type JudgeResult = { ok: true; judgments: Judgment[] } | { ok: false; error: string };

/** Как и разбор: на ответ не по схеме один повтор. Оценки без пары в issues и повторные отбрасываются. */
export async function judgeHints(
  provider: Provider,
  request: ModelRequest,
  issues: Issue[],
): Promise<JudgeResult> {
  const wanted = new Set(judgedIndexes(issues));
  const result = await runStructured(responseSchema, provider, request);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const judgments = result.data.hints.filter((j) => wanted.delete(j.index));
  return { ok: true, judgments: judgments.sort((a, b) => a.index - b.index) };
}
