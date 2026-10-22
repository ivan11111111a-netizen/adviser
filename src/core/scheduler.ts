/**
 * Режим (6.2 плана): mentor — сам и по ступеням; reviewer — сам, реже и сразу с решением;
 * manual — только по команде. «Свой» режим — это триггеры и лимиты в .adviser/config.json.
 */
export const MODES = ['mentor', 'reviewer', 'manual'] as const;
export type Mode = (typeof MODES)[number];

export interface Limits {
  /** Не разбирать одну функцию чаще. */
  cooldownMs: number;
  perHour: number;
  /** Страховка от зацикливания; бюджет в деньгах — этап 7. */
  perDay: number;
  /** Сколько функций берём за один триггер; остальные дождутся следующего. */
  perTrigger: number;
}

export const MENTOR_LIMITS: Limits = {
  cooldownMs: 60_000,
  perHour: 20,
  perDay: 150,
  perTrigger: 3,
};

/** «Ревьюер» вмешивается реже: не чаще 6 разборов в час (6.2 плана). */
export const REVIEWER_LIMITS: Limits = { ...MENTOR_LIMITS, perHour: 6 };

export interface Candidate {
  key: string;
  /** В строках функции есть Error-диагностики: человек ещё печатает. */
  hasErrors: boolean;
  reviewedAt?: number;
}

export type SkipReason = 'errors' | 'cooldown' | 'limit';

const HOUR = 3_600_000;

/**
 * Какие изменённые функции разобрать сейчас. sent — время запросов к модели за последние сутки
 * (ответы из кэша не считаются). Порядок кандидатов сохраняется.
 */
export function pickReady(
  candidates: Candidate[],
  sent: number[],
  now: number,
  limits: Limits,
): { ready: string[]; skipped: { key: string; reason: SkipReason }[] } {
  const inLast = (ms: number) => sent.filter((t) => now - t < ms).length;
  let left = Math.min(
    limits.perTrigger,
    limits.perHour - inLast(HOUR),
    limits.perDay - inLast(24 * HOUR),
  );
  const ready: string[] = [];
  const skipped: { key: string; reason: SkipReason }[] = [];
  for (const c of candidates) {
    const reason: SkipReason | undefined = c.hasErrors
      ? 'errors'
      : c.reviewedAt !== undefined && now - c.reviewedAt < limits.cooldownMs
        ? 'cooldown'
        : left <= 0
          ? 'limit'
          : undefined;
    if (reason) {
      skipped.push({ key: c.key, reason });
    } else {
      ready.push(c.key);
      left--;
    }
  }
  return { ready, skipped };
}

/** Нет сети или 429: повтор через 1, 2, 4… минуты, но не реже раза в 15 минут. */
export function retryDelay(failures: number): number {
  return Math.min(15 * 60_000, 60_000 * 2 ** Math.max(0, failures - 1));
}

/** C, C++ и Java — если стоит расширение языка: без него нет символов (src/core/languageSupport.ts). */
export const AUTOPILOT_LANGUAGES = [
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
  'python',
  'c',
  'cpp',
  'java',
];

export const MAX_LINES = 3000;
const MINIFIED_LINE = 500;
// target и .gradle — сборка Maven и Gradle, cmake-build-* — CLion.
const GENERATED_DIRS =
  /(^|[\\/])(node_modules|dist|out|build|target|\.gradle|cmake-build-[^\\/]*|\.git|\.venv|venv|site-packages)[\\/]/;

export interface DocumentInfo {
  path: string;
  languageId: string;
  lineCount: number;
  /** Первые строки файла: по ним видно минифицированный и сгенерированный код. */
  head: string[];
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? '';

/** Файлы .env* не отправляются никогда, даже командой. */
export const isEnvFile = (path: string) => /^\.env/i.test(fileName(path));

/** Почему автопилот не смотрит этот файл (6.1 плана); undefined — смотрит. */
export function documentSkipReason(doc: DocumentInfo): string | undefined {
  const name = fileName(doc.path);
  if (isEnvFile(doc.path)) {
    return 'файлы .env* не отправляются';
  }
  if (!AUTOPILOT_LANGUAGES.includes(doc.languageId)) {
    return `язык ${doc.languageId} автопилот не разбирает`;
  }
  if (GENERATED_DIRS.test(doc.path) || /\.min\.[jt]s$/i.test(name)) {
    return 'сборка или зависимости';
  }
  if (doc.lineCount > MAX_LINES) {
    return `файл длиннее ${MAX_LINES} строк`;
  }
  if (doc.head.some((line) => line.length > MINIFIED_LINE)) {
    return 'похоже на минифицированный код';
  }
  if (doc.head.some((line) => /@generated|DO NOT EDIT/.test(line))) {
    return 'сгенерированный файл';
  }
  return undefined;
}
