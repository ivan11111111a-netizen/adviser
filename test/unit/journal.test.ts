import { describe, expect, test } from 'vitest';
import {
  daysAgo,
  journalFileSchema,
  learnerProfile,
  masteredPatterns,
  matchByPattern,
  mergeJournals,
  renderReport,
  repeatsOf,
  weeklyReport,
  WEEK,
  type JournalEntry,
} from '../../src/core/journal';

const DAY = 86_400_000;
const now = 100 * DAY;
let n = 0;

const entry = (patternId: string, daysAgo: number, over: Partial<JournalEntry> = {}) =>
  ({
    id: `e${n++}`,
    patternId,
    severity: 'warning',
    languageId: 'javascript',
    file: 'file:///study/cart.js',
    line: 3,
    text: 'Что будет с пустым массивом?',
    at: now - daysAgo * DAY,
    step: 1,
    ...over,
  }) as JournalEntry;

test('схема файла журнала', () => {
  expect(journalFileSchema.safeParse({ version: 1, entries: [entry('x', 1)] }).success).toBe(true);
  expect(
    journalFileSchema.safeParse({ version: 1, entries: [{ ...entry('x', 1), step: 4 }] }).success,
  ).toBe(false);
});

test('daysAgo считает календарные дни, а не сутки', () => {
  const now = new Date(2026, 9, 20, 0, 30).getTime();
  expect(daysAgo(new Date(2026, 9, 20, 0, 5).getTime(), now)).toBe(0);
  expect(daysAgo(new Date(2026, 9, 19, 23, 50).getTime(), now)).toBe(1);
  expect(daysAgo(new Date(2026, 8, 30, 12).getTime(), now)).toBe(20);
});

test('mergeJournals: объединение по id, ступени только растут, исправление не отменяется', () => {
  const a = entry('x', 2, { id: 'same', step: 2 });
  const b = { ...a, step: 1 as const, resolvedAt: now };
  const other = entry('y', 1);
  expect(mergeJournals([a], [b, other])).toEqual([{ ...a, step: 2, resolvedAt: now }, other]);
});

test('matchByPattern: тот же тип — тот же случай, лишние прежние — исправлены', () => {
  const previous = [{ patternId: 'off-by-one' }, { patternId: 'loose-equality' }];
  const { matched, resolved } = matchByPattern(
    previous,
    ['loose-equality', 'missing-return'],
    (p) => p.patternId,
  );
  expect(matched).toEqual([previous[1], undefined]);
  expect(resolved).toEqual([previous[0]]);
});

describe('repeatsOf', () => {
  test('считает прошлые случаи того же типа за неделю и отдаёт последний', () => {
    const old = entry('off-by-one', 13);
    const first = entry('off-by-one', 5);
    const second = entry('off-by-one', 2);
    const other = entry('loose-equality', 1);
    const current = entry('off-by-one', 0);
    const all = [old, second, first, other, current];
    expect(repeatsOf(all, current)).toEqual({ count: 2, last: second });
    expect(repeatsOf(all, first)).toEqual({ count: 0, last: undefined });
  });

  test('other не считается одним типом', () => {
    const all = [entry('other', 2), entry('other', 1)];
    expect(repeatsOf(all, entry('other', 0)).count).toBe(0);
  });
});

describe('профиль и освоенные', () => {
  const entries = [
    entry('off-by-one', 1),
    entry('off-by-one', 3),
    entry('loose-equality', 2),
    entry('other', 1),
    entry('other', 2),
    entry('mutating-input', 30),
    entry('mutating-input', 40),
    entry('division-by-zero', 35),
  ];

  test('профиль — частые за три недели, other не входит', () => {
    expect(learnerProfile(entries, now).map((p) => [p.patternId, p.count])).toEqual([
      ['off-by-one', 2],
      ['loose-equality', 1],
    ]);
  });

  test('освоено — было хотя бы дважды и не повторялось три недели', () => {
    expect(masteredPatterns(entries, now).map((p) => p.patternId)).toEqual(['mutating-input']);
  });
});

describe('weeklyReport', () => {
  const entries = [
    entry('off-by-one', 1, { resolvedAt: now - DAY / 2, step: 2 }),
    entry('off-by-one', 2, { resolvedAt: now - DAY, step: 3 }),
    entry('loose-equality', 3),
    entry('loose-equality', 9),
    entry('division-by-zero', 10),
    entry('off-by-one', 12, { resolvedAt: now - 11 * DAY }),
  ];

  test('топ недели с прошлой неделей, ушедшие, доля «дошёл сам»', () => {
    const report = weeklyReport(entries, now);
    expect(report.from).toBe(now - WEEK);
    expect(report.total).toBe(3);
    expect(report.top.map((p) => [p.patternId, p.count, p.previous])).toEqual([
      ['off-by-one', 2, 1],
      ['loose-equality', 1, 1],
    ]);
    expect(report.gone.map((p) => p.patternId)).toEqual(['division-by-zero']);
    expect([report.resolved, report.selfSolved]).toEqual([2, 1]);
    expect(report.levelUp).toBe(false);
  });

  test('почти всё исправлено самим — предложение поднять уровень', () => {
    const solved = Array.from({ length: 10 }, (_, i) =>
      entry('off-by-one', 1, { resolvedAt: now - i * 1000, step: i ? 1 : 3 }),
    );
    expect(weeklyReport(solved, now).levelUp).toBe(true);
  });

  test('renderReport', () => {
    const text = renderReport(weeklyReport(entries, now), {
      title: (id) => `«${id}»`,
      day: (t) => `день ${t / DAY}`,
      level: 'beginner',
    });
    expect(text).toContain('# Adviser: неделя с день 93 по день 100');
    expect(text).toContain('из них сам, не открывая готовое решение: 1 (50%)');
    expect(text).toContain('| «off-by-one» | 2 | 1 |');
    expect(text).toContain('- «division-by-zero» (было 1)');
    expect(
      renderReport(weeklyReport([], now), { title: String, day: String, level: 'beginner' }),
    ).toContain('За неделю замечаний не было.');
  });
});
