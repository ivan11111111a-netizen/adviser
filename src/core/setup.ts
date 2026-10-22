import { untranslated, type Translate } from './i18n';

/** Мастер первого запуска (этап 8, 6.9 плана): три пути к модели в этом порядке. */
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export const OLLAMA_URL = 'http://localhost:11434/v1';

/** Ответ OpenAI-совместимого GET /models: { data: [{ id }] }. Ollama отвечает так же. */
export function parseModelList(body: unknown): string[] {
  if (
    typeof body !== 'object' ||
    body === null ||
    !Array.isArray((body as { data?: unknown }).data)
  ) {
    return [];
  }
  return (body as { data: unknown[] }).data
    .map((m) => (typeof m === 'object' && m !== null ? (m as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort();
}

/** Ошибка в id модели OpenRouter: «автор/модель», бесплатные — с :free. undefined — всё в порядке. */
export function checkOpenRouterModel(id: string, t: Translate = untranslated): string | undefined {
  const value = id.trim();
  if (!value) {
    return t('enter a model');
  }
  if (!/^[\w.-]+\/[\w.:-]+$/.test(value)) {
    return t('an OpenRouter model id looks like "author/model", for example "qwen/…:free"');
  }
  return undefined;
}
