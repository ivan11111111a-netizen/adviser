import type { z } from 'zod';
import { reviewSchema, SEVERITIES, type Review, type Severity } from './reviewSchema';

export interface ModelRequest {
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
}

/** Расход токенов на один запрос к модели. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Общий интерфейс провайдеров моделей (src/providers/). Возвращает разобранный JSON без проверки.
 * onUsage — расход запроса, если провайдер его сообщает (для учёта денег, 6.9 плана).
 */
export interface Provider {
  complete(
    request: ModelRequest,
    signal?: AbortSignal,
    onUsage?: (usage: Usage) => void,
  ): Promise<unknown>;
}

/** Провайдер бросает её, если модель ответила не JSON. На неё, как и на ответ не по схеме, движок делает один повтор. */
export class InvalidResponseError extends Error {}

export const MIN_CONFIDENCE = 0.5;
export const MAX_ISSUES = 3;

/**
 * invalid — модель дважды ответила не по схеме: повторять тот же код бесполезно.
 * Иначе ошибка сети или провайдера (429, таймаут) — её стоит повторить позже.
 */
export type StructuredResult<T> =
  { ok: true; data: T } | { ok: false; error: string; invalid: boolean };

export type ReviewResult =
  { ok: true; review: Review } | { ok: false; error: string; invalid: boolean };

/** Запрос к модели с ответом по схеме: на ответ не по схеме или не JSON — один повтор. */
export async function runStructured<T>(
  schema: z.ZodType<T>,
  provider: Provider,
  request: ModelRequest,
  signal?: AbortSignal,
  onUsage?: (usage: Usage) => void,
): Promise<StructuredResult<T>> {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await provider.complete(request, signal, onUsage);
    } catch (e) {
      if (!(e instanceof InvalidResponseError)) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), invalid: false };
      }
      lastError = e.message;
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      return { ok: true, data: parsed.data };
    }
    lastError = parsed.error.message;
  }
  return {
    ok: false,
    error: `ответ модели дважды не прошёл проверку схемы: ${lastError}`,
    invalid: true,
  };
}

export async function runReview(
  provider: Provider,
  request: ModelRequest,
  signal?: AbortSignal,
  onUsage?: (usage: Usage) => void,
): Promise<ReviewResult> {
  const result = await runStructured(reviewSchema, provider, request, signal, onUsage);
  return result.ok ? { ok: true, review: keepBest(result.data) } : result;
}

/** Порог уверенности и не больше MAX_ISSUES замечаний: сначала серьёзные, потом уверенные. */
function keepBest(review: Review): Review {
  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  const issues = review.issues
    .filter((i) => i.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => rank(a.severity) - rank(b.severity) || b.confidence - a.confidence)
    .slice(0, MAX_ISSUES);
  return { ...review, issues };
}
