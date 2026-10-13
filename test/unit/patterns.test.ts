import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  normalizePatternIds,
  parsePatterns,
  patternsFor,
  renderPatterns,
  type Pattern,
} from '../../src/core/patterns';
import { mockReview } from '../../src/providers/mock';

const pattern = (id: string, languages?: Pattern['languages']): Pattern => ({
  id,
  title: { ru: `про ${id}`, en: `about ${id}` },
  languages,
});

test('patterns/patterns.json проходит схему, типов 30–50', () => {
  const patterns = parsePatterns(JSON.parse(readFileSync('patterns/patterns.json', 'utf8')));
  expect(patterns.length).toBeGreaterThanOrEqual(30);
  expect(patterns.length).toBeLessThanOrEqual(50);
  // Пример из плана (6.4) — id, на который уже ссылаются документы.
  expect(patterns.map((p) => p.id)).toContain('reduce-without-initial');
});

describe('схема файла', () => {
  const parse = (patterns: unknown[]) => () => parsePatterns({ patterns });

  test('повтор id, не kebab-case и other в списке не проходят', () => {
    expect(parse([pattern('a'), pattern('a')])).toThrow(/повторяются/);
    expect(parse([pattern('Off_By_One')])).toThrow(/kebab-case/);
    expect(parse([pattern('other')])).toThrow(/other/);
  });

  test('неизвестное семейство языков и пустое название не проходят', () => {
    expect(parse([{ ...pattern('a'), languages: ['java'] }])).toThrow();
    expect(parse([{ ...pattern('a'), title: { ru: '', en: 'x' } }])).toThrow();
  });
});

describe('фильтр по языку файла', () => {
  const all = [pattern('common'), pattern('js-only', ['js']), pattern('ts-only', ['ts'])];
  const ids = (languageId: string) => patternsFor(all, languageId).map((p) => p.id);

  test('js покрывает и TypeScript, ts — только TypeScript', () => {
    expect(ids('javascript')).toEqual(['common', 'js-only']);
    expect(ids('typescriptreact')).toEqual(['common', 'js-only', 'ts-only']);
  });

  test('для прочих языков — только общие типы', () => {
    expect(ids('python')).toEqual(['common']);
    expect(ids('java')).toEqual(['common']);
  });
});

test('список для промпта — названия на языке советов', () => {
  const list = [pattern('a'), pattern('b')];
  expect(renderPatterns(list, 'ru')).toBe('- a — про a\n- b — про b');
  expect(renderPatterns(list, 'en')).toBe('- a — about a\n- b — about b');
});

test('id не из списка становится other, известные и other остаются', () => {
  const issue = mockReview.issues[0];
  const review = {
    ...mockReview,
    issues: [
      { ...issue, patternId: 'off-by-one' },
      { ...issue, patternId: 'empty-array-average' },
      { ...issue, patternId: 'other' },
    ],
  };
  const result = normalizePatternIds(review, [pattern('off-by-one')]);
  expect(result.review.issues.map((i) => i.patternId)).toEqual(['off-by-one', 'other', 'other']);
  expect(result.unknown).toEqual(['empty-array-average']);
  expect(review.issues[1].patternId).toBe('empty-array-average');
});
