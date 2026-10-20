import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  ADVICE_LANGUAGES,
  buildPrompt,
  LEVELS,
  numberLines,
  parseTemplate,
  PROMPT_VERSION,
  resolveLanguage,
} from '../../src/core/promptBuilder';
import { reviewJsonSchema } from '../../src/core/reviewSchema';

test('нумерует строки с единицы и выравнивает номера', () => {
  const code = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\r\n');
  const lines = numberLines(code).split('\n');
  expect(lines[0]).toBe(' 1 | l1');
  expect(lines[9]).toBe('10 | l10');
});

describe('язык советов', () => {
  test('явная настройка важнее интерфейса', () => {
    expect(resolveLanguage('en', 'ru')).toBe('en');
    expect(resolveLanguage('ru', 'de')).toBe('ru');
  });

  test('auto: русский интерфейс — ru, любой другой — en', () => {
    expect(resolveLanguage('auto', 'ru')).toBe('ru');
    expect(resolveLanguage(undefined, 'RU-ru')).toBe('ru');
    expect(resolveLanguage('auto', 'en')).toBe('en');
    expect(resolveLanguage('auto', 'uk')).toBe('en');
    expect(resolveLanguage('klingon', 'zh-cn')).toBe('en');
  });
});

const TEMPLATE = parseTemplate(
  '  Ты наставник.\n{{level}}\n- {{language}}\n{{patterns}}\n\n## level: beginner\n\nНовичок.\n\n## language: ru\nПо-русски.\n## language: en\nIn English.\n',
);

const PATTERNS = [{ id: 'off-by-one', title: { ru: 'на единицу', en: 'off by one' } }];

test('файл промпта делится на инструкцию и разделы по видам', () => {
  expect(TEMPLATE).toEqual({
    base: 'Ты наставник.\n{{level}}\n- {{language}}\n{{patterns}}',
    sections: {
      level: { beginner: 'Новичок.' },
      language: { ru: 'По-русски.', en: 'In English.' },
    },
  });
});

test('инструкция с уровнем, языком и типами ошибок — в system, код в конце — в prompt', () => {
  const req = buildPrompt(TEMPLATE, {
    languageId: 'python',
    code: 'def f():\n    pass',
    level: 'beginner',
    language: 'en',
    patterns: PATTERNS,
  });
  expect(req.system).toBe('Ты наставник.\nНовичок.\n- In English.\n- off-by-one — off by one');
  expect(req.prompt).toBe(
    'Язык программирования: python\n\n<code>\n1 | def f():\n2 |     pass\n</code>\n',
  );
  expect(req.jsonSchema).toBe(reviewJsonSchema);
});

test('без нужного раздела промпт не собирается', () => {
  expect(() =>
    buildPrompt(TEMPLATE, {
      languageId: 'js',
      code: '',
      level: 'advanced',
      language: 'ru',
      patterns: PATTERNS,
    }),
  ).toThrow(/## level: advanced/);
});

describe('профиль учащегося', () => {
  const template = parseTemplate(
    'Наставник.\n{{profile}}\n\n## profile: none\n\n## profile: some\nЧасто ошибается:\n{{topPatterns}}\n',
  );
  const input = {
    languageId: 'javascript',
    code: '',
    level: 'beginner' as const,
    language: 'ru' as const,
    patterns: PATTERNS,
  };

  test('есть частые ошибки — раздел some со списком', () => {
    const { system } = buildPrompt(template, {
      ...input,
      profile: [{ patternId: 'off-by-one', count: 3 }],
    });
    expect(system).toBe('Наставник.\nЧасто ошибается:\n- off-by-one — на единицу (×3)');
  });

  test('ошибки не этого языка и пустой профиль — раздел none', () => {
    const python = [{ patternId: 'mutable-default-argument', count: 5 }];
    expect(buildPrompt(template, { ...input, profile: python }).system).toBe('Наставник.\n');
    expect(buildPrompt(template, input).system).toBe('Наставник.\n');
  });
});

test('окружение уходит, только если промпт объясняет тег <context>', () => {
  const input = {
    languageId: 'javascript',
    code: 'f()',
    level: 'beginner' as const,
    language: 'ru' as const,
    patterns: PATTERNS,
    context: 'Зависимости проекта: lodash 4',
  };
  const knows = parseTemplate('Наставник. Между тегами <context> — справка.');
  expect(buildPrompt(knows, input).prompt).toBe(
    'Язык программирования: javascript\n\n<context>\nЗависимости проекта: lodash 4\n</context>\n\n<code>\n1 | f()\n</code>\n',
  );
  expect(buildPrompt(parseTemplate('Наставник.'), input).prompt).not.toContain('<context>');
});

const PROMPTS = readdirSync('prompts').filter((f) => f.endsWith('.md'));

test.each(PROMPTS)('prompts/%s собирается для всех уровней, языков и профилей', (file) => {
  const template = parseTemplate(readFileSync(`prompts/${file}`, 'utf8'));
  for (const level of LEVELS) {
    for (const language of ADVICE_LANGUAGES) {
      for (const profile of [[], [{ patternId: 'off-by-one', count: 2 }]]) {
        const { system } = buildPrompt(template, {
          languageId: 'js',
          code: '',
          level,
          language,
          patterns: PATTERNS,
          profile,
        });
        expect(system).toContain(template.sections.level[level]);
        expect(system).toContain(template.sections.language[language]);
        expect(system).toContain(`- off-by-one — ${PATTERNS[0].title[language]}`);
        expect(system).not.toMatch(/\{\{|^## /m);
      }
    }
  }
});

test(`текущий промпт ${PROMPT_VERSION} лежит в prompts/`, () => {
  expect(PROMPTS).toContain(`${PROMPT_VERSION}.md`);
});
