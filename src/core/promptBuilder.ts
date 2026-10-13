import type { ModelRequest } from './engine';
import { reviewJsonSchema } from './reviewSchema';

/** Версия промпта. Войдёт в ключ кэша: изменённый промпт — новый файл prompts/mentor.vN.md. */
export const PROMPT_VERSION = 'mentor.v1';

/** Уровень учащегося (6.7 плана): от него зависит, о чём наставник говорит и о чём молчит. */
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type Level = (typeof LEVELS)[number];

export interface PromptTemplate {
  /** Инструкция с местом {{level}} для текста уровня. */
  base: string;
  levels: Partial<Record<Level, string>>;
}

export interface PromptInput {
  languageId: string;
  code: string;
  level: Level;
}

const LEVEL_HEADING = /^## level: (\S+)[ \t]*$/m;

/** Файл промпта: до первого «## level: …» — инструкция, дальше — тексты уровней, по одному на заголовок. */
export function parseTemplate(text: string): PromptTemplate {
  const [base, ...rest] = text.split(LEVEL_HEADING);
  const levels: PromptTemplate['levels'] = {};
  for (let i = 0; i + 1 < rest.length; i += 2) {
    if ((LEVELS as readonly string[]).includes(rest[i])) {
      levels[rest[i] as Level] = rest[i + 1].trim();
    }
  }
  return { base: base.trim(), levels };
}

export function numberLines(code: string): string {
  const lines = code.split(/\r?\n/);
  const width = String(lines.length).length;
  return lines.map((line, i) => `${String(i + 1).padStart(width)} | ${line}`).join('\n');
}

/** Стабильная часть (инструкция и уровень) идёт в system, код — в конце, чтобы работало кэширование у провайдера. */
export function buildPrompt(template: PromptTemplate, input: PromptInput): ModelRequest {
  const level = template.levels[input.level];
  if (level === undefined || !template.base.includes('{{level}}')) {
    throw new Error(`в промпте ${PROMPT_VERSION} нет {{level}} или текста уровня ${input.level}`);
  }
  return {
    system: template.base.replace('{{level}}', level),
    prompt: `Язык: ${input.languageId}\n\n<code>\n${numberLines(input.code)}\n</code>\n`,
    jsonSchema: reviewJsonSchema,
  };
}
