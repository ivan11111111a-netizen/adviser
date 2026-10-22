import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  buildExercisePrompt,
  EXERCISE_PROMPT_VERSION,
  exerciseChoices,
  exerciseJsonSchema,
  exerciseLanguage,
  exerciseText,
  wrap,
} from '../../src/core/exercise';
import type { JournalEntry } from '../../src/core/journal';
import { fitsLanguage, primaryLanguage, type Pattern } from '../../src/core/patterns';
import { ADVICE_LANGUAGES, LEVELS, parseTemplate } from '../../src/core/promptBuilder';

const pattern = (id: string, languages?: Pattern['languages']): Pattern => ({
  id,
  title: { ru: `про ${id}`, en: `about ${id}` },
  languages,
});

const offByOne = pattern('off-by-one');
const mutableDefault = pattern('mutable-default-argument', ['py']);
const looseEquality = pattern('loose-equality', ['js']);
const all = [offByOne, mutableDefault, looseEquality];

const entry = (patternId: string, languageId: string) =>
  ({ id: `${patternId}-${languageId}`, patternId, languageId }) as JournalEntry;

test('fitsLanguage и primaryLanguage', () => {
  expect(fitsLanguage(mutableDefault, 'python')).toBe(true);
  expect(fitsLanguage(mutableDefault, 'javascript')).toBe(false);
  expect(primaryLanguage(mutableDefault)).toBe('python');
  expect(primaryLanguage(pattern('x', ['c']))).toBe('c');
  expect(primaryLanguage(offByOne)).toBe('javascript');
});

test('в запросе только тип ошибки и язык, без кода учащегося', () => {
  const template = parseTemplate('Упражнение. {{level}}\n\n## level: beginner\n\nНовичок.');
  const request = buildExercisePrompt(template, {
    pattern: offByOne,
    languageId: 'python',
    level: 'beginner',
    language: 'ru',
  });
  expect(request.system).toBe('Упражнение. Новичок.');
  expect(request.prompt).toBe(
    'Язык программирования: python\n\nТип ошибки: off-by-one — про off-by-one\n',
  );
  expect(request.jsonSchema).toBe(exerciseJsonSchema);
});

test('выбор: частые ошибки сверху со счётом, потом типы языка файла без повторов', () => {
  const choices = exerciseChoices(
    all,
    [
      { patternId: 'mutable-default-argument', count: 4, lastAt: 0 },
      { patternId: 'unknown-id', count: 2, lastAt: 0 },
    ],
    'javascript',
  );
  expect(choices.map((c) => [c.pattern.id, c.count])).toEqual([
    ['mutable-default-argument', 4],
    ['off-by-one', undefined],
    ['loose-equality', undefined],
  ]);
});

test('язык упражнения: где ошибка была чаще, иначе язык файла, иначе основной язык типа', () => {
  const entries = [
    entry('off-by-one', 'python'),
    entry('off-by-one', 'python'),
    entry('off-by-one', 'java'),
    entry('off-by-one', 'markdown'),
  ];
  expect(exerciseLanguage(entries, offByOne, 'javascript')).toBe('python');
  expect(exerciseLanguage([], offByOne, 'java')).toBe('java');
  expect(exerciseLanguage([], offByOne, 'markdown')).toBe('javascript');
  // В JavaScript этой ошибки не бывает — Python.
  expect(exerciseLanguage([], mutableDefault, 'javascript')).toBe('python');
});

test('текст файла: условие комментарием языка сверху, функция ниже', () => {
  const exercise = {
    task: 'Верни первый элемент.',
    code: 'def first(items):\n    return items[1]\n',
  };
  expect(exerciseText(exercise, offByOne, 'python', 'ru')).toBe(
    [
      '# Упражнение Adviser: про off-by-one.',
      '# Верни первый элемент.',
      '# В функции есть такая ошибка. Найди и исправь её, а потом проверь себя:',
      '# «Adviser: Разобрать эту функцию».',
      '',
      'def first(items):',
      '    return items[1]',
      '',
    ].join('\n'),
  );
  expect(exerciseText(exercise, offByOne, 'java', 'en')).toMatch(
    /^\/\/ Adviser exercise: about off-by-one\.\n/,
  );
});

test('wrap переносит по словам', () => {
  expect(wrap('раз два три четыре', 9)).toEqual(['раз два', 'три', 'четыре']);
  expect(wrap('', 10)).toEqual([]);
});

test(`prompts/${EXERCISE_PROMPT_VERSION}.md собирается для всех уровней и языков`, () => {
  const real = parseTemplate(readFileSync(`prompts/${EXERCISE_PROMPT_VERSION}.md`, 'utf8'));
  for (const level of LEVELS) {
    for (const language of ADVICE_LANGUAGES) {
      const { system } = buildExercisePrompt(real, {
        pattern: offByOne,
        languageId: 'javascript',
        level,
        language,
      });
      expect(system).toContain(real.sections.level[level]);
      expect(system).toContain(real.sections.language[language]);
      expect(system).not.toMatch(/\{\{|^## /m);
    }
  }
});
