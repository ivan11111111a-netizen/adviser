import type { ModelRequest } from './engine';
import { reviewJsonSchema } from './reviewSchema';

/** Версия промпта. Войдёт в ключ кэша: изменённый промпт — новый файл prompts/mentor.vN.md. */
export const PROMPT_VERSION = 'mentor.v1';

export interface PromptInput {
  languageId: string;
  code: string;
}

export function numberLines(code: string): string {
  const lines = code.split(/\r?\n/);
  const width = String(lines.length).length;
  return lines.map((line, i) => `${String(i + 1).padStart(width)} | ${line}`).join('\n');
}

/** Стабильная часть (инструкция) идёт в system, код — в конце, чтобы работало кэширование у провайдера. */
export function buildPrompt(template: string, input: PromptInput): ModelRequest {
  return {
    system: template.trim(),
    prompt: `Язык: ${input.languageId}\n\n<code>\n${numberLines(input.code)}\n</code>\n`,
    jsonSchema: reviewJsonSchema,
  };
}
