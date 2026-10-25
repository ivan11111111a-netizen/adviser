import { expect, test } from 'vitest';
import { hintLeak, newInFix, stripCommentsAndStrings } from '../../src/core/hintGuard';

const code =
  'def print_names(names):\n    for i in range(len(names)):\n        print(i + 1, names[i])';
const fix = 'for number, name in enumerate(names, start=1):\n    print(number, name)';

test('newInFix: новые имена и операторы решения, без слов языка и того, что уже есть в коде', () => {
  // number — слово типов TypeScript, оно ничего не выдаёт.
  expect(newInFix(fix, code, 'python')).toEqual(['name', 'enumerate', 'start']);
  expect(newInFix('if (a === b) {}', 'if (a == b) {}', 'javascript')).toEqual(['===']);
});

test('hintLeak: намёк называет новое из решения — утечка', () => {
  expect(
    hintLeak('А нет ли встроенной enumerate для номера и элемента?', fix, code, 'python'),
  ).toBe('enumerate');
  expect(hintLeak('Что сравнивает ===, а что ==?', 'a === b', 'a == b', 'javascript')).toBe('===');
});

test('hintLeak: вопрос про проблему без ответа — не утечка', () => {
  expect(hintLeak('Зачем тебе здесь индекс сам по себе?', fix, code, 'python')).toBeUndefined();
  // Слово из кода учащегося — не утечка, даже если оно есть и в решении.
  expect(hintLeak('Что лежит в names на последнем шаге?', fix, code, 'python')).toBeUndefined();
});

test('слова из комментариев и строк решения — речь, а не имена: не утечка', () => {
  const avg = 'function avg(a) {\n  return sum(a) / a.length;\n}';
  const guarded =
    'function avg(a) {\n  // what should an empty array give?\n  if (a.length === 0) return 0;\n  return sum(a) / a.length;\n}';
  expect(
    hintLeak('What happens when the array has nothing in it?', guarded, avg, 'javascript'),
  ).toBeUndefined();
  const message = 'if not scores:\n    raise ValueError("cannot average an empty list")';
  expect(
    hintLeak('What will the function do with an empty list?', message, 'x', 'python'),
  ).toBeUndefined();
  // А новое имя в самом коде решения — по-прежнему утечка.
  expect(hintLeak('Is there a ValueError for this?', message, 'x', 'python')).toBe('ValueError');
});

test('stripCommentsAndStrings: комментарии по языку; // в Python — деление, # в строке — строка', () => {
  expect(stripCommentsAndStrings('half = n // 2  # floor', 'python')).toBe('half = n // 2   ');
  expect(stripCommentsAndStrings("s = '#tag'  # note", 'python')).toBe('s =     ');
  expect(stripCommentsAndStrings("x = 1; // don't /* a */ y", 'c')).toBe('x = 1;  ');
  expect(stripCommentsAndStrings('a /* b */ c', 'java')).toBe('a   c');
  expect(newInFix('half = n // 2', 'half = n / 2', 'python')).toEqual(['//']);
  expect(newInFix('x = 1 // comment', 'x = 1', 'javascript')).toEqual([]);
});
