import { expect, test } from 'vitest';
import { hintLeak, newInFix } from '../../src/core/hintGuard';

const code =
  'def print_names(names):\n    for i in range(len(names)):\n        print(i + 1, names[i])';
const fix = 'for number, name in enumerate(names, start=1):\n    print(number, name)';

test('newInFix: новые имена и операторы решения, без слов языка и того, что уже есть в коде', () => {
  // number — слово типов TypeScript, оно ничего не выдаёт.
  expect(newInFix(fix, code)).toEqual(['name', 'enumerate', 'start']);
  expect(newInFix('if (a === b) {}', 'if (a == b) {}')).toEqual(['===']);
});

test('hintLeak: намёк называет новое из решения — утечка', () => {
  expect(hintLeak('А нет ли встроенной enumerate для номера и элемента?', fix, code)).toBe(
    'enumerate',
  );
  expect(hintLeak('Что сравнивает ===, а что ==?', 'a === b', 'a == b')).toBe('===');
});

test('hintLeak: вопрос про проблему без ответа — не утечка', () => {
  expect(hintLeak('Зачем тебе здесь индекс сам по себе?', fix, code)).toBeUndefined();
  // Слово из кода учащегося — не утечка, даже если оно есть и в решении.
  expect(hintLeak('Что лежит в names на последнем шаге?', fix, code)).toBeUndefined();
});
