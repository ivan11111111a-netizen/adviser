import { describe, expect, test } from 'vitest';
import type { EvalCase } from '../../evals/cases';
import { scoreCase, summarize, withMinConfidence } from '../../evals/score';
import type { Issue } from '../../src/core/reviewSchema';
import { mockReview } from '../../src/providers/mock';

const issue = (
  patternId: string,
  startLine: number,
  endLine = startLine,
  over: Partial<Issue> = {},
) => ({ ...mockReview.issues[0], patternId, startLine, endLine, ...over }) as Issue;

const average: EvalCase = {
  file: 'js/average-price.js',
  expect: [
    { patterns: ['reduce-without-initial'], lines: [2, 2] },
    { patterns: ['empty-collection', 'division-by-zero'], lines: [3, 3] },
  ],
  allow: ['mutating-input'],
};

describe('scoreCase', () => {
  test('совпадение по типу и строкам, с запасом в строку', () => {
    const score = scoreCase(average, [
      issue('reduce-without-initial', 1),
      issue('division-by-zero', 3, 4),
    ]);
    expect(score).toEqual({ verdicts: ['match', 'match'], missed: [] });
  });

  test('верный тип не на тех строках — шум и пропуск', () => {
    const score = scoreCase(average, [issue('reduce-without-initial', 5)]);
    expect(score).toEqual({ verdicts: ['noise'], missed: [0, 1] });
  });

  test('второе замечание про то же — duplicate, разрешённое — allowed, прочее — шум', () => {
    const score = scoreCase(average, [
      issue('empty-collection', 3),
      issue('division-by-zero', 3),
      issue('mutating-input', 1, 4),
      issue('missing-null-check', 2),
    ]);
    expect(score).toEqual({ verdicts: ['match', 'duplicate', 'allowed', 'noise'], missed: [0] });
  });
});

describe('summarize', () => {
  const clean: EvalCase = { file: 'js/clean.js', expect: [] };

  test('метрики по набору', () => {
    const summary = summarize([
      {
        evalCase: average,
        issues: [
          issue('reduce-without-initial', 2, 2, { severity: 'critical', hint: 'без вопроса' }),
          issue('missing-null-check', 1, 1, { hint: 'А если null?' }),
        ],
        seconds: 9,
      },
      { evalCase: clean, issues: [], seconds: 5 },
      { evalCase: clean, issues: [issue('magic-number', 1, 1, { hint: 'Число.' })], seconds: 7 },
      { evalCase: clean, seconds: 120 },
    ]);
    expect(summary).toEqual({
      cases: 4,
      failed: 1,
      issues: 3,
      precision: 1 / 3,
      recall: 1 / 2,
      silent: 1,
      clean: 2,
      questionHints: 1 / 2,
      medianSeconds: 7,
      judgedHints: 0,
      hintLeaks: 0,
      hintGuides: 1,
    });
  });

  test('оценки судьи', () => {
    const judgment = (index: number, leaks: boolean, guides: boolean) => ({
      index,
      leaks,
      guides,
      comment: '',
    });
    const summary = summarize([
      {
        evalCase: average,
        issues: [issue('reduce-without-initial', 2), issue('division-by-zero', 3)],
        seconds: 1,
        judgments: [judgment(0, true, true), judgment(1, false, false)],
      },
      { evalCase: clean, issues: [issue('magic-number', 1)], seconds: 1, judgments: [] },
    ]);
    expect(summary.judgedHints).toBe(2);
    expect(summary.hintLeaks).toBe(1 / 2);
    expect(summary.hintGuides).toBe(1 / 2);
  });

  test('порог уверенности отсекает замечания, оценки судьи переезжают за ними', () => {
    const judgment = (index: number) => ({
      index,
      leaks: false,
      guides: true,
      comment: `${index}`,
    });
    const result = withMinConfidence(
      {
        evalCase: average,
        issues: [
          issue('a', 1, 1, { confidence: 0.5 }),
          issue('b', 2, 2, { confidence: 0.9 }),
          issue('c', 3, 3, { confidence: 0.8 }),
        ],
        seconds: 1,
        judgments: [judgment(0), judgment(2)],
      },
      0.8,
    );
    expect(result.issues!.map((i) => i.patternId)).toEqual(['b', 'c']);
    expect(result.judgments).toEqual([{ ...judgment(2), index: 1 }]);
    expect(withMinConfidence({ evalCase: clean, seconds: 1 }, 0.8).issues).toBeUndefined();
  });

  test('пустой набор не делит на ноль', () => {
    expect(summarize([]).precision).toBe(1);
  });
});
