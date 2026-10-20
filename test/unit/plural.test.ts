import { expect, test } from 'vitest';
import { plural } from '../../src/core/plural';

test('plural: 1 день, 2 дня, 5 дней, 11 дней, 21 день, 22 дня, 112 дней', () => {
  const days = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
  expect([1, 2, 5, 11, 12, 21, 22, 25, 112].map(days)).toEqual([
    '1 день',
    '2 дня',
    '5 дней',
    '11 дней',
    '12 дней',
    '21 день',
    '22 дня',
    '25 дней',
    '112 дней',
  ]);
});
