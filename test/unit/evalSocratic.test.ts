import { expect, test } from 'vitest';
import {
  bugLines,
  indentationValid,
  parseBug,
  stripLineNumbers,
  toEvalCase,
} from '../../evals/socratic';

const numbered = [
  '1. def fibonacci(n):',
  '2.  if n <= 0:',
  '3.    return "OOPS"',
  '8.  else:',
  '9.     a = 0',
  '10.    b = 1',
  '11.    for i in range(0, n):',
].join('\n');

test('stripLineNumbers: номера одной колонкой — отступы Python сохраняются', () => {
  expect(stripLineNumbers(numbered).split('\n')).toEqual([
    'def fibonacci(n):',
    ' if n <= 0:',
    '   return "OOPS"',
    ' else:',
    '    a = 0',
    '    b = 1',
    '    for i in range(0, n):',
  ]);
});

test('stripLineNumbers: формат «номер и один пробел»', () => {
  const spaced = ['8.  else:', '9.    a = 0', '10.    b = 1'].join('\n');
  expect(stripLineNumbers(spaced).split('\n')).toEqual([' else:', '   a = 0', '   b = 1']);
});

test('indentationValid', () => {
  expect(indentationValid(['def f():', '  x = 1', '  if x:', '    y', '  return y'])).toBe(true);
  expect(indentationValid(['def f():', '  x = 1', '   y = 2'])).toBe(false);
  expect(indentationValid(['def f():', '    x = 1', '  y = 2'])).toBe(false);
});

test('bugLines: одна строка, диапазон, перечисление', () => {
  expect(bugLines('On line 11, the for loop iterates `n` times.')).toEqual([11]);
  expect(bugLines('On lines 3 and 5 the student compares ...')).toEqual([3, 4, 5]);
  expect(bugLines('Lines 4-6 never run.')).toEqual([4, 5, 6]);
  expect(bugLines('The function never returns.')).toEqual([]);
});

test('toEvalCase: условие комментарием, ожидаемые строки сдвинуты, тип — любой', () => {
  const bug = parseBug(
    '0_0_fibonacci',
    `<problem>\nCreate fibonacci(n).\nReturn the nth term.\n</problem>\n<bug_code>\n${numbered}\n</bug_code>\n<bug_desc>\nOn line 11, the loop runs n times.\n</bug_desc>`,
  );
  const { text, evalCase } = toEvalCase(bug, 'x.py');
  expect(text.split('\n').slice(0, 4)).toEqual([
    '# Create fibonacci(n).',
    '# Return the nth term.',
    '',
    'def fibonacci(n):',
  ]);
  // Комментарий из двух строк и пустая: строка 11 кода — это строка 14 файла.
  expect(evalCase).toEqual({ file: 'x.py', expect: [{ patterns: ['*'], lines: [14, 14] }] });
});
