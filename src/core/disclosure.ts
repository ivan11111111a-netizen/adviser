import type { Issue } from './reviewSchema';

/** Ступени раскрытия (6.5 плана): 1 — намёк, 2 — объяснение, 3 — код. */
export type Step = 1 | 2 | 3;

/**
 * Подача: mentor — по ступеням; reviewer — режим «Ревьюер» (6.5 плана): ступеней нет,
 * сразу объяснение и решение.
 */
export type Presentation = 'mentor' | 'reviewer';

/**
 * Есть ли намёк. У уязвимостей его нет: про них объясняем сразу. Пустой намёк — его убрал фильтр
 * утечек (hintGuard) или модель его не дала.
 *
 * Раньше намёк пропускался у всех critical (6.5 плана). Eval на настоящих ошибках новичков
 * (Socratic Debugging Benchmark) показал: модель помечает critical 77% таких ошибок — неверный
 * результат «ломает» код. С прежним правилом учащийся почти не видел намёков, а это главная
 * механика Adviser.
 */
export const hasHint = (issue: Pick<Issue, 'category' | 'hint'>) =>
  issue.category !== 'security' && issue.hint.trim() !== '';

/** Какую ступень видно сразу: без намёка — объяснение, ревьюеру — всё сразу. */
export function firstStep(
  issue: Pick<Issue, 'category' | 'hint'>,
  presentation: Presentation = 'mentor',
): Step {
  if (presentation === 'reviewer') {
    return 3;
  }
  return hasHint(issue) ? 1 : 2;
}

/** Ступени только открываются: «Объяснить» после показанного решения ничего не прячет. */
export function reveal(current: Step, requested: Step): Step {
  return requested > current ? requested : current;
}

/**
 * Текст подчёркивания и вкладки «Проблемы» — первая ступень: намёк, а для уязвимостей, замечаний
 * без намёка и ревьюера — объяснение.
 */
export function diagnosticText(issue: Issue, presentation: Presentation = 'mentor'): string {
  return presentation === 'mentor' && hasHint(issue) ? issue.hint : issue.explanation;
}

export interface HoverView {
  /** Объяснение, если оно открыто и ещё не показано в подчёркивании. */
  explanation?: string;
  /** Ссылка идёт вместе с объяснением, и только https. */
  readMore?: string;
  /** Пример, на котором видна ошибка, — тоже вместе с объяснением. */
  example?: string;
  fix?: Issue['fix'];
  /** Кнопки: 2 — «Объяснить», 3 — «Показать решение». */
  actions: Exclude<Step, 1>[];
}

/** Что показать в hover поверх подчёркивания: открытые ступени после первой и кнопки следующих. */
export function hoverView(
  issue: Issue,
  step: Step,
  presentation: Presentation = 'mentor',
): HoverView {
  const shown = Math.max(step, firstStep(issue, presentation)) as Step;
  const inUnderline = diagnosticText(issue, presentation) === issue.explanation;
  // Решения может не быть: его скрыл преподаватель (правила курса).
  const hasFix = issue.fix.code.trim() !== '';
  return {
    explanation: shown >= 2 && !inUnderline ? issue.explanation : undefined,
    readMore: shown >= 2 && issue.readMore?.startsWith('https://') ? issue.readMore : undefined,
    example: shown >= 2 && issue.example?.trim() ? issue.example : undefined,
    fix: shown >= 3 && hasFix ? issue.fix : undefined,
    actions: ([2, 3] as const).filter((s) => s > shown && (s < 3 || hasFix)),
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
