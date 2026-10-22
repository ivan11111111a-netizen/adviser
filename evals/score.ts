import { hasHint } from '../src/core/disclosure';
import type { Issue } from '../src/core/reviewSchema';
import type { EvalCase, ExpectedIssue } from './cases';
import type { Judgment } from './judge';

/**
 * match — нашла ожидаемое; duplicate — ещё раз про уже найденное; allowed — по делу, но не обязательно;
 * noise — ничего из этого. Шум автор просматривает в отчёте: иногда это пропуск в ожиданиях.
 */
export type Verdict = 'match' | 'duplicate' | 'allowed' | 'noise';

export interface CaseScore {
  /** Вердикт по каждому замечанию модели, в её порядке. */
  verdicts: Verdict[];
  /** Номера ожидаемых замечаний, которые модель не нашла. */
  missed: number[];
}

type Lines = Pick<Issue, 'patternId' | 'startLine' | 'endLine'>;

/** «*» в ожидании — любой тип ошибки: в чужих наборах важно место, а не наш patternId. */
const fits = (issue: Lines, expected: ExpectedIssue) =>
  (expected.patterns.includes('*') || expected.patterns.includes(issue.patternId)) &&
  issue.startLine <= expected.lines[1] + 1 &&
  issue.endLine >= expected.lines[0] - 1;

export function scoreCase(evalCase: EvalCase, issues: Lines[]): CaseScore {
  const verdicts: (Verdict | undefined)[] = issues.map(() => undefined);
  const missed: number[] = [];
  evalCase.expect.forEach((expected, e) => {
    const i = issues.findIndex((issue, i) => !verdicts[i] && fits(issue, expected));
    if (i < 0) {
      missed.push(e);
    } else {
      verdicts[i] = 'match';
    }
  });
  return {
    verdicts: issues.map((issue, i) => {
      if (verdicts[i]) {
        return verdicts[i];
      }
      if (evalCase.expect.some((expected) => fits(issue, expected))) {
        return 'duplicate';
      }
      return evalCase.allow?.includes(issue.patternId) ? 'allowed' : 'noise';
    }),
    missed,
  };
}

export interface CaseResult {
  evalCase: EvalCase;
  /** undefined — модель не ответила или ответ не прошёл схему. */
  issues?: Issue[];
  seconds: number;
  /** Оценки намёков судьёй, если его запускали. */
  judgments?: Judgment[];
}

/** Подбор порога: оставляет замечания с confidence от min, номера в оценках судьи сдвигаются за ними. */
export function withMinConfidence(result: CaseResult, min: number): CaseResult {
  const { issues, judgments } = result;
  if (!issues) {
    return result;
  }
  const kept = issues.flatMap((issue, i) => (issue.confidence >= min ? [i] : []));
  return {
    ...result,
    issues: kept.map((i) => issues[i]),
    judgments: judgments?.flatMap((j) =>
      kept.includes(j.index) ? [{ ...j, index: kept.indexOf(j.index) }] : [],
    ),
  };
}

export interface Summary {
  cases: number;
  failed: number;
  issues: number;
  /** Доля замечаний по делу: match, duplicate и allowed. Цель этапа 3 — от 70%. */
  precision: number;
  /** Доля ожидаемых замечаний, которые нашлись. */
  recall: number;
  /** Чистых случаев без единого замечания из всех чистых. */
  silent: number;
  clean: number;
  /** Доля намёков с вопросом: hint должен спрашивать, а не утверждать. Считаем только видимые намёки (hasHint). */
  questionHints: number;
  medianSeconds: number;
  /** Сколько намёков оценил судья; 0 — судьи не было, и две доли ниже ничего не значат. */
  judgedHints: number;
  /** Доля намёков, которые выдают ответ. Цель этапа 3 — намёк не содержит готового ответа. */
  hintLeaks: number;
  /** Доля намёков, которые наводят на проблему, а не загадывают загадку. */
  hintGuides: number;
  /** Сколько замечаний с примером (mentor.v3). */
  withExample: number;
}

const ratio = (a: number, b: number) => (b === 0 ? 1 : a / b);

export function summarize(results: CaseResult[]): Summary {
  const answered = results.filter((r) => r.issues);
  const scores = answered.map((r) => scoreCase(r.evalCase, r.issues!));
  const verdicts = scores.flatMap((s) => s.verdicts);
  const expected = answered.reduce((n, r) => n + r.evalCase.expect.length, 0);
  const missed = scores.reduce((n, s) => n + s.missed.length, 0);
  const clean = answered.filter((r) => r.evalCase.expect.length === 0);
  const hints = answered.flatMap((r) => r.issues!).filter(hasHint);
  const seconds = answered.map((r) => r.seconds).sort((a, b) => a - b);
  const judgments = answered.flatMap((r) => r.judgments ?? []);
  return {
    cases: results.length,
    failed: results.length - answered.length,
    issues: verdicts.length,
    precision: ratio(verdicts.filter((v) => v !== 'noise').length, verdicts.length),
    recall: ratio(expected - missed, expected),
    silent: clean.filter((r) => r.issues!.length === 0).length,
    clean: clean.length,
    questionHints: ratio(hints.filter((i) => i.hint.includes('?')).length, hints.length),
    medianSeconds: seconds.length ? seconds[Math.floor(seconds.length / 2)] : 0,
    judgedHints: judgments.length,
    hintLeaks: 1 - ratio(judgments.filter((j) => !j.leaks).length, judgments.length),
    hintGuides: ratio(judgments.filter((j) => j.guides).length, judgments.length),
    withExample: answered.flatMap((r) => r.issues!).filter((i) => i.example?.trim()).length,
  };
}
