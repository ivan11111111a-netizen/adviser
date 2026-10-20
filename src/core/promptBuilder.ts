import type { ModelRequest } from './engine';
import { renderPatterns, renderProfile, type Pattern } from './patterns';
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
  /** Инструкция с местами {{level}}, {{language}}, {{patterns}} и, если нужно, {{profile}}. */
  base: string;
  /**
   * Варианты текста для мест: sections.level.beginner, sections.language.ru,
   * sections.profile.none и sections.profile.some (в нём — место {{topPatterns}}).
   */
  sections: Record<string, Record<string, string>>;
}

export interface PromptInput {
  languageId: string;
  code: string;
  level: Level;
  language: AdviceLanguage;
  /** Типы ошибок для языка файла (patternsFor). */
  patterns: Pattern[];
  /** Частые ошибки учащегося (learnerProfile). Нужны, только если в промпте есть {{profile}}. */
  profile?: { patternId: string; count: number }[];
  /** Окружение функции (buildContext). Уходит, только если промпт объясняет тег <context>. */
  context?: string;
  /** Правила стиля проекта (renderRules). Нужны, только если в промпте есть {{rules}}. */
  rules?: string;
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

/**
 * Стабильная часть (инструкция, уровень, язык, типы ошибок) идёт в system, код — в конце:
 * так работает кэширование у провайдера.
 */
export function buildPrompt(template: PromptTemplate, input: PromptInput): ModelRequest {
  // В профиль идут только ошибки, возможные в этом языке: mutable-default-argument в JS не нужен.
  const profile = (input.profile ?? []).filter((p) =>
    input.patterns.some((q) => q.id === p.patternId),
  );
  const chosen: Record<string, string> = {
    level: input.level,
    language: input.language,
    profile: profile.length ? 'some' : 'none',
    rules: input.rules ? 'some' : 'none',
  };
  const fill = (text: string): string =>
    text.replace(/\{\{(\w+)\}\}/g, (_, kind: string) => {
      if (kind === 'patterns') {
        return renderPatterns(input.patterns, input.language);
      }
      if (kind === 'topPatterns') {
        return renderProfile(profile, input.patterns, input.language);
      }
      if (kind === 'projectRules') {
        // Текст из репозитория: подставляется как есть, его {{…}} не разворачиваются.
        return input.rules ?? '';
      }
      const section = template.sections[kind]?.[chosen[kind]];
      if (section === undefined) {
        throw new Error(`в промпте нет раздела «## ${kind}: ${chosen[kind]}»`);
      }
      return fill(section);
    });
  const system = fill(template.base);
  // Промпт, который не говорит, что <context> — только справка, получил бы чужой код на разбор.
  const context =
    input.context && system.includes('<context>')
      ? `<context>\n${input.context}\n</context>\n\n`
      : '';
  return {
    system,
    prompt: `Язык программирования: ${input.languageId}\n\n${context}<code>\n${numberLines(input.code)}\n</code>\n`,
    jsonSchema: reviewJsonSchema,
  };
}
