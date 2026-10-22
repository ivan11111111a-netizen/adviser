import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  extraIssues,
  parseExerciseCases,
  renderExerciseReport,
  summarizeExercises,
  type ExerciseRecord,
} from '../../evals/exercise';
import { fitsLanguage, parsePatterns } from '../../src/core/patterns';

test('набор evals/exercise-cases.json: типы есть в patterns.json и бывают в своём языке', () => {
  const patterns = parsePatterns(JSON.parse(readFileSync('patterns/patterns.json', 'utf8')));
  const cases = parseExerciseCases(JSON.parse(readFileSync('evals/exercise-cases.json', 'utf8')));
  for (const c of cases) {
    const pattern = patterns.find((p) => p.id === c.pattern);
    expect(pattern, c.pattern).toBeDefined();
    expect(fitsLanguage(pattern!, c.languageId), `${c.pattern} в ${c.languageId}`).toBe(true);
  }
});

const record = (
  pattern: string,
  issues?: [string, 'critical' | 'suggestion'][],
): ExerciseRecord => ({
  pattern,
  languageId: 'javascript',
  task: 'Условие.',
  code: 'function f() {}',
  issues: issues?.map(([patternId, severity]) => ({ patternId, severity, hint: '?' })),
});

test('summarizeExercises: нашлась ли нужная ошибка и есть ли лишние, suggestion не в счёт', () => {
  const records = [
    record('off-by-one', [
      ['off-by-one', 'critical'],
      ['unclear-name', 'suggestion'],
    ]),
    record('off-by-one', [
      ['off-by-one', 'critical'],
      ['empty-collection', 'critical'],
    ]),
    record('loose-equality', []),
    { ...record('x'), error: '429' },
  ];
  expect(extraIssues(records[1]).map((i) => i.patternId)).toEqual(['empty-collection']);
  expect(summarizeExercises(records)).toEqual({ total: 4, failed: 1, found: 2, withExtra: 1 });
  const md = renderExerciseReport(
    { id: 'x', date: 'сегодня', model: 'sonnet', prompt: 'exercise.v1', reviewPrompt: 'mentor.v3' },
    records,
  );
  expect(md).toContain('| Ошибка нужного типа нашлась | 2 из 3 |');
  expect(md).toContain('## loose-equality, javascript — не нашлась');
});
