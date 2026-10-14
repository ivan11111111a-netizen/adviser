import { reviewSchema, SEVERITIES, type Review, type Severity } from './reviewSchema';

export interface ModelRequest {
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
}

/** Общий интерфейс провайдеров моделей (src/providers/). Возвращает разобранный JSON без проверки. */
export interface Provider {
  complete(request: ModelRequest, signal?: AbortSignal): Promise<unknown>;
}

/** Провайдер бросает её, если модель ответила не JSON. На неё, как и на ответ не по схеме, движок делает один повтор. */
export class InvalidResponseError extends Error {}

export const MIN_CONFIDENCE = 0.5;
export const MAX_ISSUES = 3;

/**
 * invalid — модель дважды ответила не по схеме: повторять тот же код бесполезно.
 * Иначе ошибка сети или провайдера (429, таймаут) — её стоит повторить позже.
 */
export type ReviewResult =
  { ok: true; review: Review } | { ok: false; error: string; invalid: boolean };

export async function runReview(
  provider: Provider,
  request: ModelRequest,
  signal?: AbortSignal,
): Promise<ReviewResult> {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await provider.complete(request, signal);
    } catch (e) {
      if (!(e instanceof InvalidResponseError)) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), invalid: false };
      }
      lastError = e.message;
      continue;
    }
    const parsed = reviewSchema.safeParse(raw);
    if (parsed.success) {
      return { ok: true, review: keepBest(parsed.data) };
    }
    lastError = parsed.error.message;
  }
  return {
    ok: false,
    error: `ответ модели дважды не прошёл проверку схемы: ${lastError}`,
    invalid: true,
  };
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
