import { readFileSync } from 'node:fs';
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

test(`prompts/${PROMPT_VERSION}.md собирается для всех уровней и языков`, () => {
  const template = parseTemplate(readFileSync(`prompts/${PROMPT_VERSION}.md`, 'utf8'));
  for (const level of LEVELS) {
    for (const language of ADVICE_LANGUAGES) {
      const { system } = buildPrompt(template, {
        languageId: 'js',
        code: '',
        level,
        language,
        patterns: PATTERNS,
      });
      expect(system).toContain(template.sections.level[level]);
      expect(system).toContain(template.sections.language[language]);
      expect(system).toContain(`- off-by-one — ${PATTERNS[0].title[language]}`);
      expect(system).not.toMatch(/\{\{|^## /m);
    }
  }
});
