import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  buildPrompt,
  LEVELS,
  numberLines,
  parseTemplate,
  PROMPT_VERSION,
} from '../../src/core/promptBuilder';
import { reviewJsonSchema } from '../../src/core/reviewSchema';

test('нумерует строки с единицы и выравнивает номера', () => {
  const code = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\r\n');
  const lines = numberLines(code).split('\n');
  expect(lines[0]).toBe(' 1 | l1');
  expect(lines[9]).toBe('10 | l10');
});

test('файл промпта делится на инструкцию и тексты уровней', () => {
  const template = parseTemplate(
    '  Ты наставник.\n\n{{level}}\n\n## level: beginner\n\nНовичок.\n\n## level: advanced\nОпытный.\n## level: guru\nНет такого.\n',
  );
  expect(template).toEqual({
    base: 'Ты наставник.\n\n{{level}}',
    levels: { beginner: 'Новичок.', advanced: 'Опытный.' },
  });
});

test('инструкция с уровнем — в system, код в конце — в prompt', () => {
  const template = parseTemplate('Ты наставник.\n{{level}}\n## level: beginner\nНовичок.');
  const req = buildPrompt(template, {
    languageId: 'python',
    code: 'def f():\n    pass',
    level: 'beginner',
  });
  expect(req.system).toBe('Ты наставник.\nНовичок.');
  expect(req.prompt).toBe('Язык: python\n\n<code>\n1 | def f():\n2 |     pass\n</code>\n');
  expect(req.jsonSchema).toBe(reviewJsonSchema);
});

test('без текста уровня промпт не собирается', () => {
  const template = parseTemplate('Ты наставник.\n{{level}}\n## level: beginner\nНовичок.');
  expect(() => buildPrompt(template, { languageId: 'js', code: '', level: 'advanced' })).toThrow(
    /advanced/,
  );
});

test(`в prompts/${PROMPT_VERSION}.md есть {{level}} и тексты всех уровней`, () => {
  const template = parseTemplate(readFileSync(`prompts/${PROMPT_VERSION}.md`, 'utf8'));
  for (const level of LEVELS) {
    const { system } = buildPrompt(template, { languageId: 'js', code: '', level });
    expect(system).not.toMatch(/\{\{|## level/);
  }
});
