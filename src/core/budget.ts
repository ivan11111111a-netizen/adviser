import type { Usage } from './engine';
import { untranslated, type Translate } from './i18n';

/** Расход за день: токены и число запросов к модели. */
export interface DayUsage extends Usage {
  requests: number;
}

/** Расход по дням, ключ — местная дата YYYY-MM-DD. */
export type UsageLog = Record<string, DayUsage>;

/**
 * Цены и лимиты (6.9 плана) — только из настроек пользователя. Цен в коде нет: они меняются,
 * а у бесплатных и локальных моделей их нет вовсе. 0 — не считать или без лимита.
 */
export interface Budget {
  inputPerMillion: number;
  outputPerMillion: number;
  dailyUsd: number;
  monthlyUsd: number;
}

/** Сколько дней расхода хранить: на месячный лимит хватает с запасом. */
const KEEP_DAYS = 62;

export function dayKey(time: number): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const EMPTY: DayUsage = { inputTokens: 0, outputTokens: 0, requests: 0 };

const sum = (a: DayUsage, b: DayUsage): DayUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  requests: a.requests + b.requests,
});

/** Новый журнал расхода с ещё одним запросом; дни старше двух месяцев уходят. */
export function addUsage(log: UsageLog, time: number, usage: Usage): UsageLog {
  const key = dayKey(time);
  const oldest = dayKey(time - KEEP_DAYS * 86_400_000);
  const kept = Object.entries(log).filter(([day]) => day >= oldest);
  const today = sum(log[key] ?? EMPTY, { ...usage, requests: 1 });
  return { ...Object.fromEntries(kept), [key]: today };
}

export function usageTotals(log: UsageLog, now: number): { today: DayUsage; month: DayUsage } {
  const month = dayKey(now).slice(0, 7);
  return {
    today: log[dayKey(now)] ?? EMPTY,
    month: Object.entries(log)
      .filter(([day]) => day.startsWith(month))
      .reduce((total, [, day]) => sum(total, day), EMPTY),
  };
}

export function costUsd(usage: Usage, budget: Budget): number {
  return (
    (usage.inputTokens * budget.inputPerMillion + usage.outputTokens * budget.outputPerMillion) /
    1_000_000
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Почему разборы на паузе из-за денег; undefined — лимиты не заданы или не исчерпаны. */
export function budgetExceeded(
  log: UsageLog,
  now: number,
  budget: Budget,
  t: Translate = untranslated,
): string | undefined {
  const { today, month } = usageTotals(log, now);
  if (budget.dailyUsd > 0 && costUsd(today, budget) >= budget.dailyUsd) {
    return t('daily limit of {0} reached', usd(budget.dailyUsd));
  }
  if (budget.monthlyUsd > 0 && costUsd(month, budget) >= budget.monthlyUsd) {
    return t('monthly limit of {0} reached', usd(budget.monthlyUsd));
  }
  return undefined;
}

/** «requests: 3, tokens: 12.5k, $0.02»: деньги — только если заданы цены. */
export function formatUsage(day: DayUsage, budget: Budget, t: Translate = untranslated): string {
  const tokens = day.inputTokens + day.outputTokens;
  // Целая и дробная часть отдельно: десятичный знак у языков разный («12.5k», «12,5 тыс.»).
  const [whole, fraction] = (tokens / 1000).toFixed(1).split('.');
  const amount = tokens >= 1000 ? t('{0}.{1}k', whole, fraction) : String(tokens);
  const priced = budget.inputPerMillion > 0 || budget.outputPerMillion > 0;
  const cost = priced ? `, ${usd(costUsd(day, budget))}` : '';
  return t('requests: {0}, tokens: {1}', day.requests, amount) + cost;
}
