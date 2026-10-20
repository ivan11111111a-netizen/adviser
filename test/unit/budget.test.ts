import { describe, expect, test } from 'vitest';
import {
  addUsage,
  budgetExceeded,
  costUsd,
  dayKey,
  formatUsage,
  usageTotals,
  type Budget,
} from '../../src/core/budget';

const at = (month: number, day: number, hour = 12) =>
  new Date(2026, month - 1, day, hour).getTime();
const free: Budget = { inputPerMillion: 0, outputPerMillion: 0, dailyUsd: 0, monthlyUsd: 0 };
const paid: Budget = { inputPerMillion: 2, outputPerMillion: 10, dailyUsd: 0.05, monthlyUsd: 1 };

test('dayKey — местная дата', () => {
  expect(dayKey(at(10, 3, 23))).toBe('2026-10-03');
});

describe('addUsage и usageTotals', () => {
  let log = addUsage({}, at(9, 30), { inputTokens: 1000, outputTokens: 100 });
  log = addUsage(log, at(10, 19), { inputTokens: 2000, outputTokens: 200 });
  log = addUsage(log, at(10, 20), { inputTokens: 4000, outputTokens: 400 });
  log = addUsage(log, at(10, 20, 15), { inputTokens: 4000, outputTokens: 400 });

  test('день и календарный месяц', () => {
    expect(usageTotals(log, at(10, 20, 18))).toEqual({
      today: { inputTokens: 8000, outputTokens: 800, requests: 2 },
      month: { inputTokens: 10_000, outputTokens: 1000, requests: 3 },
    });
  });

  test('дни старше двух месяцев уходят', () => {
    const later = addUsage(log, at(12, 15), { inputTokens: 1, outputTokens: 1 });
    expect(Object.keys(later)).toEqual(['2026-10-19', '2026-10-20', '2026-12-15']);
  });
});

test('costUsd и budgetExceeded', () => {
  const usage = { inputTokens: 10_000, outputTokens: 2000 };
  expect(costUsd(usage, paid)).toBeCloseTo(0.04);
  const log = addUsage({}, at(10, 20), usage);
  expect(budgetExceeded(log, at(10, 20), paid)).toBeUndefined();
  const more = addUsage(log, at(10, 20), usage);
  expect(budgetExceeded(more, at(10, 20), paid)).toBe('дневной лимит $0.05 исчерпан');
  expect(budgetExceeded(more, at(10, 21), paid)).toBeUndefined();
  expect(budgetExceeded(more, at(10, 21), { ...paid, monthlyUsd: 0.08 })).toBe(
    'месячный лимит $0.08 исчерпан',
  );
  expect(budgetExceeded(more, at(10, 20), free)).toBeUndefined();
});

test('formatUsage: деньги — только с ценами', () => {
  const day = { inputTokens: 11_000, outputTokens: 1500, requests: 3 };
  expect(formatUsage(day, free)).toBe('запросов: 3, токенов: 12,5 тыс.');
  expect(formatUsage(day, paid)).toBe('запросов: 3, токенов: 12,5 тыс., $0.04');
});
