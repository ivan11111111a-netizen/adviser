import { expect, test } from 'vitest';
import { applyCourse, applyCourseText, NO_COURSE } from '../../src/core/course';
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

test('applyCourseText — те же запретные слова в любом тексте Adviser', () => {
  expect(
    applyCourseText('Верно, enumerate тут подходит.', {
      ...NO_COURSE,
      forbidden: ['enumerate', ' '],
    }),
  ).toBe('Верно, … тут подходит.');
});

test('hideSolutions — решения нет ни у одного замечания, пример остаётся', () => {
  const result = applyCourse(issue({ example: 'first([]) // undefined' }), {
    ...NO_COURSE,
    hideSolutions: true,
  });
  expect(result.fix.code).toBe('');
  expect(result.example).toBe('first([]) // undefined');
});

test('пример с запретным словом не показывается: «…» сломало бы код', () => {
  const course = { ...NO_COURSE, forbidden: ['enumerate'] };
  expect(applyCourse(issue({ example: 'list(enumerate(xs))' }), course).example).toBeUndefined();
});
