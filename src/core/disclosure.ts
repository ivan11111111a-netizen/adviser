import type { Issue, Severity } from './reviewSchema';

/** Ступени раскрытия (6.5 плана): 1 — намёк, 2 — объяснение, 3 — код. */
export type Step = 1 | 2 | 3;

/** Какую ступень видно сразу. Для critical намёк неуместен: код сломан, поэтому сразу объясняем. */
export function firstStep(severity: Severity): Step {
  return severity === 'critical' ? 2 : 1;
}

/** Ступени только открываются: «Объяснить» после показанного решения ничего не прячет. */
export function reveal(current: Step, requested: Step): Step {
  return requested > current ? requested : current;
}

/** Текст подчёркивания и вкладки «Проблемы» — первая ступень: намёк, а для critical объяснение. */
export function diagnosticText(issue: Issue): string {
  return firstStep(issue.severity) === 1 ? issue.hint : issue.explanation;
}

export interface HoverView {
  /** Объяснение, если оно открыто и ещё не показано в подчёркивании. */
  explanation?: string;
  /** Ссылка идёт вместе с объяснением, и только https. */
  readMore?: string;
  fix?: Issue['fix'];
  /** Кнопки: 2 — «Объяснить», 3 — «Показать решение». */
  actions: Exclude<Step, 1>[];
}

/** Что показать в hover поверх подчёркивания: открытые ступени после первой и кнопки следующих. */
export function hoverView(issue: Issue, step: Step): HoverView {
  const shown = Math.max(step, firstStep(issue.severity)) as Step;
  return {
    explanation: shown >= 2 && firstStep(issue.severity) < 2 ? issue.explanation : undefined,
    readMore: shown >= 2 && issue.readMore?.startsWith('https://') ? issue.readMore : undefined,
    fix: shown >= 3 ? issue.fix : undefined,
    actions: ([2, 3] as const).filter((s) => s > shown),
  };
}

/** Короткая цитата первой ступени: по ней видно, к какому подчёркиванию относятся кнопки. */
export function shortQuote(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) {
    return flat;
  }
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.:;!?—-]+$/, '')}…`;
}
