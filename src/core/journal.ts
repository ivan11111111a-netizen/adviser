import { z } from 'zod';
import type { Step } from './disclosure';
import { OTHER_PATTERN } from './patterns';
import type { Level } from './promptBuilder';
import { SEVERITIES } from './reviewSchema';

const DAY = 86_400_000;
export const WEEK = 7 * DAY;
/** Тип ошибки, который не повторялся три недели, считается освоенным и уходит из профиля (6.6 плана). */
export const MASTERED_AFTER = 21 * DAY;
export const PROFILE_SIZE = 5;
/** «Ты так уже делал» — с третьего случая за неделю, то есть когда до него было хотя бы два. */
export const REMIND_FROM = 2;

/** Случай ошибки в журнале. Повторный разбор той же функции продолжает случай, а не заводит новый. */
export const journalEntrySchema = z.object({
  id: z.string(),
  patternId: z.string(),
  severity: z.enum(SEVERITIES),
  languageId: z.string(),
  /** uri файла. Журнал не покидает машину. */
  file: z.string(),
  /** Строка файла, с нуля, на момент разбора. */
  line: z.number().int().min(0),
  /** Первая ступень: намёк, у critical — объяснение. */
  text: z.string(),
  at: z.number(),
  /** До какой ступени человек дошёл. */
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Замечание пропало при новом разборе изменённого кода — значит, исправлено. */
  resolvedAt: z.number().optional(),
});

export type JournalEntry = z.infer<typeof journalEntrySchema>;

export const journalFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(journalEntrySchema),
});

/**
 * Журналы двух окон VS Code пишут один файл, поэтому перед записью сливаем по id:
 * ступени только растут, исправление не отменяется.
 */
export function mergeJournals(a: JournalEntry[], b: JournalEntry[]): JournalEntry[] {
  const byId = new Map(a.map((e) => [e.id, e]));
  for (const entry of b) {
    const other = byId.get(entry.id);
    if (!other) {
      byId.set(entry.id, entry);
      continue;
    }
    const resolved = [other.resolvedAt, entry.resolvedAt].filter((t) => t !== undefined);
    byId.set(entry.id, {
      ...other,
      step: Math.max(other.step, entry.step) as Step,
      resolvedAt: resolved.length ? Math.min(...resolved) : undefined,
    });
  }
  return [...byId.values()].sort((x, y) => x.at - y.at);
}

/**
 * Новые замечания функции против прежних. Тот же тип ошибки — тот же случай: он сохраняет id
 * и открытую ступень. Прежние без пары исчезли — их считаем исправленными.
 */
export function matchByPattern<T>(
  previous: T[],
  fresh: string[],
  patternOf: (t: T) => string,
): { matched: (T | undefined)[]; resolved: T[] } {
  const left = [...previous];
  const matched = fresh.map((patternId) => {
    const i = left.findIndex((p) => patternOf(p) === patternId);
    return i < 0 ? undefined : left.splice(i, 1)[0];
  });
  return { matched, resolved: left };
}

/** Сколько раз этот тип ошибки уже был за неделю до этого случая, и последний из них. */
export function repeatsOf(
  entries: readonly JournalEntry[],
  entry: JournalEntry,
): { count: number; last?: JournalEntry } {
  // other — не один тип, а «ничего не подошло»: его повторы ничего не говорят.
  if (entry.patternId === OTHER_PATTERN) {
    return { count: 0 };
  }
  const before = entries
    .filter(
      (e) =>
        e.id !== entry.id &&
        e.patternId === entry.patternId &&
        e.at < entry.at &&
        entry.at - e.at <= WEEK,
    )
    .sort((x, y) => x.at - y.at);
  return { count: before.length, last: before[before.length - 1] };
}

export interface PatternCount {
  patternId: string;
  count: number;
  lastAt: number;
}

/** Случаи по типам ошибок за [from, to): чаще — выше, при равенстве — свежее. other не считаем. */
export function countPatterns(
  entries: readonly JournalEntry[],
  from: number,
  to: number,
): PatternCount[] {
  const counts = new Map<string, PatternCount>();
  for (const e of entries) {
    if (e.patternId === OTHER_PATTERN || e.at < from || e.at >= to) {
      continue;
    }
    const c = counts.get(e.patternId) ?? { patternId: e.patternId, count: 0, lastAt: 0 };
    c.count++;
    c.lastAt = Math.max(c.lastAt, e.at);
    counts.set(e.patternId, c);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

/** Профиль для промпта: самые частые ошибки за три недели. Освоенные сюда уже не попадают. */
export function learnerProfile(entries: readonly JournalEntry[], now: number): PatternCount[] {
  return countPatterns(entries, now - MASTERED_AFTER, now + 1).slice(0, PROFILE_SIZE);
}

/**
 * Освоенные типы: встречались хотя бы дважды (один случай — ещё не привычка),
 * но последние три недели не повторялись.
 */
export function masteredPatterns(entries: readonly JournalEntry[], now: number): PatternCount[] {
  return countPatterns(entries, 0, now + 1).filter(
    (p) => p.count >= 2 && now - p.lastAt > MASTERED_AFTER,
  );
}

export interface WeeklyReport {
  from: number;
  to: number;
  total: number;
  /** Топ-5 недели и сколько их было неделей раньше. */
  top: (PatternCount & { previous: number })[];
  /** Были неделей раньше, а на этой неделе — ни разу. */
  gone: PatternCount[];
  /** Исправлено за неделю и из них без готового решения — главная метрика (раздел 15 плана). */
  resolved: number;
  selfSolved: number;
  mastered: PatternCount[];
  /** Почти всё человек исправляет сам — пора предложить уровень выше (6.7 плана). */
  levelUp: boolean;
}

const LEVEL_UP_MIN_RESOLVED = 10;
const LEVEL_UP_SHARE = 0.8;

export function weeklyReport(entries: readonly JournalEntry[], now: number): WeeklyReport {
  const from = now - WEEK;
  const week = countPatterns(entries, from, now + 1);
  const previous = countPatterns(entries, from - WEEK, from);
  const resolved = entries.filter(
    (e) => e.resolvedAt !== undefined && e.resolvedAt >= from && e.resolvedAt <= now,
  );
  const selfSolved = resolved.filter((e) => e.step < 3).length;
  return {
    from,
    to: now,
    total: entries.filter((e) => e.at >= from && e.at <= now).length,
    top: week.slice(0, PROFILE_SIZE).map((p) => ({
      ...p,
      previous: previous.find((q) => q.patternId === p.patternId)?.count ?? 0,
    })),
    gone: previous.filter((p) => !week.some((q) => q.patternId === p.patternId)),
    resolved: resolved.length,
    selfSolved,
    mastered: masteredPatterns(entries, now),
    levelUp:
      resolved.length >= LEVEL_UP_MIN_RESOLVED && selfSolved / resolved.length >= LEVEL_UP_SHARE,
  };
}

export interface ReportFormat {
  title: (patternId: string) => string;
  day: (time: number) => string;
  level: Level;
}

const percent = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;

/** Недельный отчёт в Markdown: его показывает предпросмотр Markdown в VS Code. */
export function renderReport(report: WeeklyReport, format: ReportFormat): string {
  const { title, day } = format;
  const lines = [`# Adviser: неделя с ${day(report.from)} по ${day(report.to)}`, ''];
  if (!report.total && !report.resolved) {
    lines.push('За неделю замечаний не было.', '');
  } else {
    lines.push(
      `**Замечаний:** ${report.total}. **Исправлено:** ${report.resolved}` +
        (report.resolved
          ? `, из них сам, не открывая готовое решение: ${report.selfSolved} (${percent(report.selfSolved, report.resolved)}).`
          : '.'),
      '',
    );
  }
  if (report.top.length) {
    lines.push('## Частые ошибки', '', '| Ошибка | За неделю | Неделей раньше |', '|---|---|---|');
    for (const p of report.top) {
      lines.push(`| ${title(p.patternId)} | ${p.count} | ${p.previous} |`);
    }
    lines.push('');
  }
  if (report.gone.length) {
    lines.push('## Ушло по сравнению с прошлой неделей', '');
    for (const p of report.gone) {
      lines.push(`- ${title(p.patternId)} (было ${p.count})`);
    }
    lines.push('');
  }
  if (report.mastered.length) {
    lines.push('## Освоено', '', 'Эти ошибки не повторялись три недели:', '');
    for (const p of report.mastered) {
      lines.push(`- ${title(p.patternId)}`);
    }
    lines.push('');
  }
  if (report.levelUp && format.level !== 'advanced') {
    lines.push(
      `> Ты исправляешь сам ${percent(report.selfSolved, report.resolved)} замечаний. ` +
        'Может, поднять уровень? Настройка `adviser.level`.',
      '',
    );
  }
  return lines.join('\n');
}
