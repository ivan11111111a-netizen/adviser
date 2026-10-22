import { describe, expect, test } from 'vitest';
import {
  combineJournals,
  daysAgo,
  disagreements,
  journalSummary,
  journalFileSchema,
  learnerProfile,
  masteredPatterns,
  matchByPattern,
  mergeJournals,
  openCasesIn,
  renderReport,
  repeatsOf,
  solutionDelayActive,
  solutionWait,
  weeklyReport,
  WEEK,
  type JournalEntry,
} from '../../src/core/journal';
import { ru } from './ru';

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

describe('пауза перед решением', () => {
  const opened = (n: number, step: 1 | 2 | 3, over: Partial<JournalEntry> = {}) =>
    Array.from({ length: n }, () => entry('off-by-one', 1, { step, ...over }));

  test('auto: включается, если решение открывали в 70% случаев и чаще (от 10)', () => {
    expect(solutionDelayActive([...opened(7, 3), ...opened(3, 1)], now, 'auto')).toBe(true);
    expect(solutionDelayActive([...opened(6, 3), ...opened(4, 2)], now, 'auto')).toBe(false);
    expect(solutionDelayActive(opened(9, 3), now, 'auto')).toBe(false);
  });

  test('ревьюер и critical не считаются; always и off — без счёта', () => {
    expect(solutionDelayActive(opened(12, 3, { reviewer: true }), now, 'auto')).toBe(false);
    expect(solutionDelayActive(opened(12, 3, { severity: 'critical' }), now, 'auto')).toBe(false);
    expect(solutionDelayActive([], now, 'always')).toBe(true);
    expect(solutionDelayActive(opened(12, 3), now, 'off')).toBe(false);
  });

  test('solutionWait: минута с появления замечания, у critical — без ожидания', () => {
    expect(solutionWait({ at: now - 20_000, severity: 'warning' }, now)).toBe(40_000);
    expect(solutionWait({ at: now - 90_000, severity: 'warning' }, now)).toBe(0);
    expect(solutionWait({ at: now, severity: 'critical' }, now)).toBe(0);
  });
});

test('disagreements и ответ при слиянии журналов', () => {
  const a = entry('magic-number', 1, { id: 'm1', feedback: 'disagree' });
  const all = [a, entry('magic-number', 2, { feedback: 'understood' }), entry('off-by-one', 1)];
  expect(disagreements(all, 'magic-number')).toBe(1);
  expect(mergeJournals([{ ...a, feedback: undefined }], [a])[0].feedback).toBe('disagree');
  expect(weeklyReport(all, now).disagreed).toBe(1);
});

test('«объяснил сам»: не теряется при слиянии, считается в отчёте и сводке', () => {
  const a = entry('off-by-one', 1, { id: 'x1', explained: true });
  const all = [a, entry('off-by-one', 2), entry('loose-equality', 10, { explained: true })];
  expect(mergeJournals([a], [{ ...a, explained: undefined }])[0].explained).toBe(true);
  expect(mergeJournals([{ ...a, explained: undefined }], [a])[0].explained).toBe(true);
  const report = weeklyReport(all, now);
  expect(report.explained).toBe(1);
  expect(
    renderReport(report, { title: (id) => id, day: () => 'день', level: 'beginner', t: ru }),
  ).toContain('Сам объяснил, в чём ошибка («Проверь меня»): 1.');
  expect(journalSummary(all)).toMatchObject({ explained: 2 });
});

describe('combineJournals', () => {
  test('очистка в одном окне не воскрешается другим, старше года — уходит', () => {
    const old = entry('off-by-one', 400);
    const beforeClear = entry('off-by-one', 5);
    const afterClear = entry('loose-equality', 1);
    const disk = { version: 1 as const, entries: [old, beforeClear] };
    const merged = combineJournals(disk, [beforeClear, afterClear], now - 3 * DAY, now);
    expect(merged.entries).toEqual([afterClear]);
    expect(merged.clearedAt).toBe(now - 3 * DAY);
    expect(combineJournals(disk, [], undefined, now).entries).toEqual([beforeClear]);
  });
});

test('journalSummary: только типы и числа, без файлов и текстов', () => {
  const summary = journalSummary([
    entry('off-by-one', 3, { resolvedAt: now, step: 1 }),
    entry('off-by-one', 1, { resolvedAt: now, step: 3, feedback: 'disagree' }),
    entry('loose-equality', 2),
  ]);
  expect(summary).toMatchObject({ cases: 3, resolved: 2, selfSolved: 1 });
  expect(summary.patterns[0]).toMatchObject({
    patternId: 'off-by-one',
    count: 2,
    resolved: 2,
    selfSolved: 1,
    disagreed: 1,
  });
  expect(JSON.stringify(summary)).not.toMatch(/cart\.js|пустым массивом/);
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

test('openCasesIn: открытые случаи файла на этих строках, кроме тех, что на экране', () => {
  const open = entry('off-by-one', 1, { line: 5 });
  const all = [
    open,
    entry('off-by-one', 1, { line: 5, resolvedAt: now }),
    entry('off-by-one', 1, { line: 30 }),
    entry('off-by-one', 1, { line: 5, file: 'file:///study/other.js' }),
    entry('loose-equality', 1, { line: 6, id: 'shown' }),
  ];
  expect(openCasesIn(all, open.file, { start: 3, end: 10 }, new Set(['shown']))).toEqual([open]);
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
      t: ru,
    });
    expect(text).toContain('# Adviser: неделя с день 93 по день 100');
    expect(text).toContain('из них сам, не открывая готовое решение: 1 (50%)');
    expect(text).toContain('| «off-by-one» | 2 | 1 |');
    expect(text).toContain('- «division-by-zero» (было 1)');
    expect(
      renderReport(weeklyReport([], now), { title: String, day: String, level: 'beginner', t: ru }),
    ).toContain('За неделю замечаний не было.');
  });
});
