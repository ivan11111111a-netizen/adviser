import { expect, test } from 'vitest';
import {
  changedLines,
  hunks,
  isRepair,
  parseRows,
  pick,
  toStudentCase,
  type StudentRow,
} from '../../evals/students';

const buggy = [
  'def reverse(a):',
  '    rev = []',
  '    i = 0',
  '    while i < len(a):',
  '        rev.append(a[len(a) - i])',
  '        i = i + 1',
  '    print(rev)',
].join('\n');

const fixed = [
  'def reverse(a):',
  '    rev = []',
  '    i = 0',
  '    while i < len(a):',
  '        rev.append(a[len(a) - i - 1])',
  '        i = i + 1',
  '    return rev',
  '',
].join('\n');

const row = (over: Partial<StudentRow> = {}): StudentRow => ({
  submission_id: 1,
  user: 'u1',
  assignment_id: 'reverse_iter',
  description: 'Reverse a list of elements.',
  test: 'assert reverse([])==[] and reverse([1, 2])==[2, 1]',
  func_code: buggy,
  annotation: fixed,
  ...over,
});

test('changedLines: заменённые строки — без соседних; пустые строки не в счёт', () => {
  expect(changedLines(buggy, fixed)).toEqual([5, 7]);
});

test('changedLines: вставка задевает обе соседние строки, отступ значим', () => {
  const code =
    'def f(x):\n    for i in x:\n        if i:\n            return True\n    return False';
  const indented =
    'def f(x):\n    for i in x:\n        if i:\n            return True\n        return False';
  expect(changedLines(indented, code)).toEqual([5]);
  const inserted = 'def f(x):\n    if not x:\n        return 0\n    return x[0]';
  expect(changedLines('def f(x):\n    return x[0]', inserted)).toEqual([1, 2]);
  expect(changedLines('a\n\tb', 'a\n    b')).toEqual([]);
});

test('hunks: соседние и через одну строки — один фрагмент', () => {
  expect(hunks([5, 7])).toEqual([[5, 7]]);
  expect(hunks([2, 3, 8])).toEqual([
    [2, 3],
    [8, 8],
  ]);
});

test('isRepair: переписанная заново функция не годится', () => {
  expect(isRepair(row())).toBe(true);
  expect(isRepair(row({ annotation: buggy }))).toBe(false);
  expect(isRepair(row({ annotation: 'def reverse(a):\n    return a[::-1]\n' }))).toBe(false);
});

test('toStudentCase: условие и проверки комментарием, строки сдвинуты, тип — любой', () => {
  const { text, evalCase } = toStudentCase(row(), 'x.py');
  expect(text.split('\n').slice(0, 6)).toEqual([
    '# Reverse a list of elements.',
    '# Tests:',
    '#   reverse([])==[]',
    '#   reverse([1, 2])==[2, 1]',
    '',
    'def reverse(a):',
  ]);
  // Комментарий в 5 строк: строки 5–7 решения — это 10–12 файла.
  expect(evalCase).toEqual({ file: 'x.py', expect: [{ patterns: ['*'], lines: [10, 12] }] });

  // Без проверок — только условие: комментарий в 2 строки.
  const bare = toStudentCase(row(), 'x.py', false);
  expect(bare.text.split('\n').slice(0, 3)).toEqual([
    '# Reverse a list of elements.',
    '',
    'def reverse(a):',
  ]);
  expect(bare.evalCase.expect).toEqual([{ patterns: ['*'], lines: [7, 9] }]);
});

test('pick: по задаче — решения разных студентов, выбор не зависит от порядка строк', () => {
  const rows = Array.from({ length: 20 }, (_, n) =>
    row({ submission_id: 100 - n, user: `u${n % 4}` }),
  );
  const sumup = row({ assignment_id: 'sumup', submission_id: 7 });
  const ids = (list: StudentRow[]) => pick(list).map((r) => r.submission_id);
  const picked = pick([...rows, sumup]);
  const reverse = picked.filter((r) => r.assignment_id === 'reverse_iter');
  // Студентов всего четверо: больше четырёх решений этой задачи не берём.
  expect(reverse).toHaveLength(4);
  expect(new Set(reverse.map((r) => r.user)).size).toBe(4);
  expect(ids([sumup, ...rows].reverse())).toEqual(ids([...rows, sumup]));
  expect(picked).toContain(sumup);
});

test('parseRows: строки JSONL', () => {
  expect(parseRows(`${JSON.stringify(row())}\n\n`)).toEqual([row()]);
});
