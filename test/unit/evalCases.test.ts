import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { languageIdOf, parseCases } from '../../evals/cases';
import { OTHER_PATTERN, parsePatterns } from '../../src/core/patterns';

const cases = parseCases(JSON.parse(readFileSync('evals/cases.json', 'utf8')));
const known = new Set([
  ...parsePatterns(JSON.parse(readFileSync('patterns/patterns.json', 'utf8'))).map((p) => p.id),
  OTHER_PATTERN,
]);

// До 9.10 было 30–50 (этап 3 плана); C и Java добавили ещё 11.
test('в наборе 30–60 случаев, из них чистых не меньше 8', () => {
  expect(cases.length).toBeGreaterThanOrEqual(30);
  expect(cases.length).toBeLessThanOrEqual(60);
  expect(cases.filter((c) => c.expect.length === 0).length).toBeGreaterThanOrEqual(8);
  expect(new Set(cases.map((c) => c.file)).size).toBe(cases.length);
});

test.each(cases)('$file: файл есть, строки в его пределах, типы из patterns.json', (c) => {
  const path = `evals/cases/${c.file}`;
  expect(existsSync(path)).toBe(true);
  expect(languageIdOf(c.file)).toBeDefined();
  const lineCount = readFileSync(path, 'utf8').trimEnd().split('\n').length;
  for (const { patterns, lines } of c.expect) {
    expect(lines[0]).toBeLessThanOrEqual(lines[1]);
    expect(lines[1]).toBeLessThanOrEqual(lineCount);
    expect(patterns.filter((p) => !known.has(p))).toEqual([]);
  }
  expect((c.allow ?? []).filter((p) => !known.has(p))).toEqual([]);
});
