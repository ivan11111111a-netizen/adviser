import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  answerSets,
  parseChangesCases,
  renderChangesReport,
  summarizeChanges,
  type ChangesRecord,
} from '../../evals/changes';
import type { Quiz } from '../../src/core/understand';

const quiz: Quiz = {
  summary: 'Проверка пустого списка.',
  questions: [
    { question: 'Что вернёт f([])?', file: 'a.js', answer: '0' },
    { question: 'Зачем начальное значение?', file: 'a.js', answer: 'Чтобы сложить числа.' },
  ],
};

test('набор evals/changes-cases.json разбирается, изменения настоящие', () => {
  const cases = parseChangesCases(JSON.parse(readFileSync('evals/changes-cases.json', 'utf8')));
  expect(cases.length).toBeGreaterThan(0);
  expect(cases.every((c) => c.before !== c.after)).toBe(true);
});

test('answerSets: правильные, «не знаю» и ответ соседнего вопроса', () => {
  expect(answerSets(quiz)).toEqual({
    expected: ['0', 'Чтобы сложить числа.'],
    dontKnow: ['не знаю', 'не знаю'],
    swapped: ['Чтобы сложить числа.', '0'],
  });
  expect(answerSets({ ...quiz, questions: quiz.questions.slice(0, 1) }).swapped).toBeUndefined();
});

test('summarizeChanges и отчёт', () => {
  const ok = (index: number, understood: boolean) => ({ index, understood, feedback: '' });
  const records: ChangesRecord[] = [
    {
      name: 'a',
      quiz,
      results: {
        expected: [ok(0, true), ok(1, true)],
        dontKnow: [ok(0, false), ok(1, false)],
        swapped: [ok(0, false), ok(1, true)],
      },
    },
    { name: 'b', results: {}, error: '429' },
  ];
  expect(summarizeChanges(records)).toEqual({
    cases: 2,
    failed: 1,
    questions: 2,
    accepted: [2, 2],
    dontKnowRejected: [2, 2],
    swappedRejected: [1, 2],
  });
  const md = renderChangesReport(
    { id: 'x', date: 'сегодня', model: 'sonnet', prompts: 'v1' },
    records,
  );
  expect(md).toContain('| Ответ на другой вопрос не засчитан | 1 из 2 |');
  expect(md).toContain(
    '2. Зачем начальное значение? — _Чтобы сложить числа._ (expected: засчитан, dontKnow: нет, swapped: засчитан)',
  );
});
