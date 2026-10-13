import type { ModelRequest } from './engine';
import { reviewJsonSchema } from './reviewSchema';

/** Версия промпта. Войдёт в ключ кэша: изменённый промпт — новый файл prompts/mentor.vN.md. */
export const PROMPT_VERSION = 'mentor.v1';

/** Уровень учащегося (6.7 плана): от него зависит, о чём наставник говорит и о чём молчит. */
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type Level = (typeof LEVELS)[number];

/** Язык советов. В настройке есть ещё auto — по языку интерфейса VS Code. */
export const ADVICE_LANGUAGES = ['ru', 'en'] as const;
export type AdviceLanguage = (typeof ADVICE_LANGUAGES)[number];

/** auto и неизвестные значения: русский интерфейс — советы по-русски, любой другой — по-английски. */
export function resolveLanguage(setting: string | undefined, uiLanguage: string): AdviceLanguage {
  const explicit = ADVICE_LANGUAGES.find((l) => l === setting);
  if (explicit) {
    return explicit;
  }
  return uiLanguage.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export interface PromptTemplate {
  /** Инструкция с местами {{level}} и {{language}}. */
  base: string;
  /** Варианты текста для этих мест: sections.level.beginner, sections.language.ru. */
  sections: Record<string, Record<string, string>>;
}

export interface PromptInput {
  languageId: string;
  code: string;
  level: Level;
  language: AdviceLanguage;
}

const SECTION_HEADING = /^## (\w+): (\S+)[ \t]*$/m;

/** Файл промпта: до первого «## вид: вариант» — инструкция, дальше — варианты, по одному на заголовок. */
export function parseTemplate(text: string): PromptTemplate {
  const [base, ...rest] = text.split(SECTION_HEADING);
  const sections: PromptTemplate['sections'] = {};
  for (let i = 0; i + 2 < rest.length; i += 3) {
    (sections[rest[i]] ??= {})[rest[i + 1]] = rest[i + 2].trim();
  }
  return { base: base.trim(), sections };
}

export function numberLines(code: string): string {
  const lines = code.split(/\r?\n/);
  const width = String(lines.length).length;
  return lines.map((line, i) => `${String(i + 1).padStart(width)} | ${line}`).join('\n');
}

/** Стабильная часть (инструкция, уровень, язык) идёт в system, код — в конце: так работает кэширование у провайдера. */
export function buildPrompt(template: PromptTemplate, input: PromptInput): ModelRequest {
  const chosen: Record<string, string> = { level: input.level, language: input.language };
  const system = template.base.replace(/\{\{(\w+)\}\}/g, (_, kind: string) => {
    const text = template.sections[kind]?.[chosen[kind]];
    if (text === undefined) {
      throw new Error(`в промпте ${PROMPT_VERSION} нет раздела «## ${kind}: ${chosen[kind]}»`);
    }
    return text;
  });
  return {
    system,
    prompt: `Язык программирования: ${input.languageId}\n\n<code>\n${numberLines(input.code)}\n</code>\n`,
    jsonSchema: reviewJsonSchema,
  };
}
