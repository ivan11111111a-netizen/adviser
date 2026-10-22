import { z } from 'zod';
import type { Step } from './disclosure';
import type { Translate } from './i18n';
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
  /** Ответ человека из лампочки (6.11 плана): «понял» или «не согласен». */
  feedback: z.enum(['understood', 'disagree']).optional(),
  /** Показан в режиме «Ревьюер»: решение открыто сразу, в «дошёл сам» такой случай не считается. */
  reviewer: z.boolean().optional(),
  /** «Проверь меня»: человек сам объяснил ошибку, видя только намёк. */
  explained: z.boolean().optional(),
});

export type JournalEntry = z.infer<typeof journalEntrySchema>;

export const journalFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(journalEntrySchema),
  /** Журнал очищали: случаи до этого времени не возвращаются, даже если они есть в другом окне. */
  clearedAt: z.number().optional(),
});

export type JournalFile = z.infer<typeof journalFileSchema>;

/** Сколько хранить случаи: для отчётов и «освоено» хватает с запасом. */
export const KEEP_DAYS = 365;

/** Слияние файла и памяти окна с учётом очистки и срока хранения. */
export function combineJournals(
  disk: JournalFile,
  mine: JournalEntry[],
  mineClearedAt: number | undefined,
  now: number,
): JournalFile {
  const clearedAt = Math.max(disk.clearedAt ?? 0, mineClearedAt ?? 0) || undefined;
  const from = Math.max(clearedAt ?? 0, now - KEEP_DAYS * DAY);
  return {
    version: 1,
    entries: mergeJournals(disk.entries, mine).filter((e) => e.at >= from),
    clearedAt,
  };
}

export interface PatternSummary {
  patternId: string;
  count: number;
  resolved: number;
  selfSolved: number;
  /** Объяснил сам через «Проверь меня». */
  explained: number;
  disagreed: number;
  /** День первого и последнего случая — без времени, файлов и текстов. */
  first: string;
  last: string;
}

/**
 * Обезличенная сводка журнала: только типы ошибок и числа. Ей можно поделиться с преподавателем
 * или в пилоте — в ней нет ни путей, ни кода, ни текстов замечаний.
 */
export function journalSummary(entries: readonly JournalEntry[]): {
  cases: number;
  resolved: number;
  selfSolved: number;
  explained: number;
  patterns: PatternSummary[];
} {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const byPattern = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    byPattern.set(e.patternId, [...(byPattern.get(e.patternId) ?? []), e]);
  }
  const stats = (list: readonly JournalEntry[]) => ({
    resolved: list.filter((e) => e.resolvedAt !== undefined).length,
    selfSolved: list.filter((e) => e.resolvedAt !== undefined && e.step < 3).length,
    explained: list.filter((e) => e.explained).length,
  });
  return {
    cases: entries.length,
    ...stats(entries),
    patterns: [...byPattern]
      .map(([patternId, list]) => ({
        patternId,
        count: list.length,
        ...stats(list),
        disagreed: list.filter((e) => e.feedback === 'disagree').length,
        first: day(Math.min(...list.map((e) => e.at))),
        last: day(Math.max(...list.map((e) => e.at))),
      }))
      .sort((a, b) => b.count - a.count || a.patternId.localeCompare(b.patternId)),
  };
}

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
      feedback: other.feedback ?? entry.feedback,
      explained: other.explained || entry.explained || undefined,
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

/**
 * Открытые случаи файла на разобранных строках, которых нет среди замечаний на экране.
 * Так бывает после перезапуска VS Code: замечания живут в памяти, а журнал — на диске.
 * Новый разбор их продолжает, иначе тот же код дал бы ложные повторы.
 */
export function openCasesIn(
  entries: readonly JournalEntry[],
  file: string,
  lines: { start: number; end: number },
  shown: ReadonlySet<string>,
): JournalEntry[] {
  return entries.filter(
    (e) =>
      e.file === file &&
      e.resolvedAt === undefined &&
      !shown.has(e.id) &&
      e.line >= lines.start &&
      e.line <= lines.end,
  );
}

/** Сколько ждать «Показать решение», когда пауза включена (вопрос 2 раздела 16 плана). */
export const SOLUTION_DELAY_MS = 60_000;
const DELAY_WINDOW = 14 * DAY;
const DELAY_MIN_CASES = 10;
const DELAY_SHARE = 0.7;

/**
 * Пауза перед решением: always — всегда, off — никогда, auto — если за две недели человек открывал
 * решение в большинстве случаев (от 70% из хотя бы 10): значит, он не успевает подумать сам.
 */
export function solutionDelayActive(
  entries: readonly JournalEntry[],
  now: number,
  setting: string,
): boolean {
  if (setting === 'always' || setting === 'off') {
    return setting === 'always';
  }
  const recent = entries.filter(
    (e) => !e.reviewer && e.severity !== 'critical' && now - e.at <= DELAY_WINDOW,
  );
  return (
    recent.length >= DELAY_MIN_CASES &&
    recent.filter((e) => e.step === 3).length / recent.length >= DELAY_SHARE
  );
}

/** Сколько ещё ждать решения по этому случаю, мс; 0 — можно. */
export function solutionWait(entry: Pick<JournalEntry, 'at' | 'severity'>, now: number): number {
  return entry.severity === 'critical' ? 0 : Math.max(0, entry.at + SOLUTION_DELAY_MS - now);
}

/** С какого «не согласен» по одному типу ошибки предлагать больше его не показывать (6.11 плана). */
export const OFFER_HIDE_AFTER = 3;

export function disagreements(entries: readonly JournalEntry[], patternId: string): number {
  return entries.filter((e) => e.patternId === patternId && e.feedback === 'disagree').length;
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

/** Сколько календарных дней назад было at, по местному времени: 0 — сегодня, 1 — вчера. */
export function daysAgo(at: number, now: number): number {
  const day = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY;
  };
  return day(now) - day(at);
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
  /** Сколько замечаний недели человек отметил «не согласен» — мера шума (раздел 15 плана). */
  disagreed: number;
  /** Сколько ошибок недели человек сам объяснил через «Проверь меня». */
  explained: number;
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
    (e) => !e.reviewer && e.resolvedAt !== undefined && e.resolvedAt >= from && e.resolvedAt <= now,
  );
  const selfSolved = resolved.filter((e) => e.step < 3).length;
  const inWeek = entries.filter((e) => e.at >= from && e.at <= now);
  return {
    from,
    to: now,
    total: inWeek.length,
    top: week.slice(0, PROFILE_SIZE).map((p) => ({
      ...p,
      previous: previous.find((q) => q.patternId === p.patternId)?.count ?? 0,
    })),
    gone: previous.filter((p) => !week.some((q) => q.patternId === p.patternId)),
    resolved: resolved.length,
    selfSolved,
    mastered: masteredPatterns(entries, now),
    disagreed: inWeek.filter((e) => e.feedback === 'disagree').length,
    explained: inWeek.filter((e) => e.explained).length,
    levelUp:
      resolved.length >= LEVEL_UP_MIN_RESOLVED && selfSolved / resolved.length >= LEVEL_UP_SHARE,
  };
}

export interface ReportFormat {
  title: (patternId: string) => string;
  day: (time: number) => string;
  level: Level;
  t: Translate;
}

const percent = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;

/** Недельный отчёт в Markdown: его показывает предпросмотр Markdown в VS Code. */
export function renderReport(report: WeeklyReport, format: ReportFormat): string {
  const { title, day, t } = format;
  const lines = [t('# Adviser: week of {0} to {1}', day(report.from), day(report.to)), ''];
  if (!report.total && !report.resolved) {
    lines.push(t('No issues this week.'), '');
  } else {
    lines.push(
      report.resolved
        ? t(
            '**Issues:** {0}. **Fixed:** {1}, of them on your own, without opening the solution: {2} ({3}).',
            report.total,
            report.resolved,
            report.selfSolved,
            percent(report.selfSolved, report.resolved),
          )
        : t('**Issues:** {0}. **Fixed:** {1}.', report.total, report.resolved),
      '',
    );
  }
  if (report.explained) {
    lines.push(t('Explained the mistake yourself ("Check me"): {0}.', report.explained), '');
  }
  if (report.disagreed) {
    lines.push(t('Disagreed with issues: {0}.', report.disagreed), '');
  }
  if (report.top.length) {
    lines.push(
      t('## Frequent mistakes'),
      '',
      t('| Mistake | This week | Week before |'),
      '|---|---|---|',
    );
    for (const p of report.top) {
      lines.push(`| ${title(p.patternId)} | ${p.count} | ${p.previous} |`);
    }
    lines.push('');
  }
  if (report.gone.length) {
    lines.push(t('## Gone since last week'), '');
    for (const p of report.gone) {
      lines.push(`- ${title(p.patternId)} ${t('(was {0})', p.count)}`);
    }
    lines.push('');
  }
  if (report.mastered.length) {
    lines.push(t('## Mastered'), '', t('These mistakes have not come back for three weeks:'), '');
    for (const p of report.mastered) {
      lines.push(`- ${title(p.patternId)}`);
    }
    lines.push('');
  }
  if (report.levelUp && format.level !== 'advanced') {
    lines.push(
      t(
        '> You fix {0} of issues on your own. Time to raise the level? Setting `adviser.level`.',
        percent(report.selfSolved, report.resolved),
      ),
      '',
    );
  }
  return lines.join('\n');
}
