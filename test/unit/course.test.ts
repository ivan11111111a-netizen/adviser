import { expect, test } from 'vitest';
import { applyCourse, NO_COURSE } from '../../src/core/course';
import type { Issue } from '../../src/core/reviewSchema';
import { mockReview } from '../../src/providers/mock';

const issue = (over: Partial<Issue>): Issue => ({ ...mockReview.issues[0], ...over });

test('без правил курса замечание не меняется', () => {
  const plain = issue({});
  expect(applyCourse(plain, NO_COURSE)).toEqual(plain);
});

test('запретные слова: в текстах — «…», решение с ними скрыто', () => {
  const result = applyCourse(
    issue({
      hint: 'Есть ли в Python способ вроде Enumerate?',
      explanation: 'enumerate отдаёт номер и элемент; sorted тут ни при чём.',
      fix: { description: 'Взять enumerate', code: 'for i, x in enumerate(xs):' },
    }),
    { ...NO_COURSE, forbidden: ['enumerate', 'sort'] },
  );
  expect(result.hint).toBe('Есть ли в Python способ вроде …?');
  // «sort» — целым словом: «sorted» не задевает.
  expect(result.explanation).toBe('… отдаёт номер и элемент; sorted тут ни при чём.');
  expect(result.fix).toEqual({ description: '', code: '' });
});

test('hideSolutions — решения нет ни у одного замечания', () => {
  expect(applyCourse(issue({}), { ...NO_COURSE, hideSolutions: true }).fix.code).toBe('');
});
