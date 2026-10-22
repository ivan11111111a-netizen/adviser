import type { Issue } from './reviewSchema';

/** Настройки курса из .adviser/config.json: их задаёт преподаватель для задания. */
export interface CourseRules {
  /** Контрольная: Adviser в этой папке молчит, даже по команде. */
  silent: boolean;
  /** Готовое решение не показывать вовсе: только намёк и объяснение. */
  hideSolutions: boolean;
  /** Слова, которых Adviser не говорит в этом задании: «enumerate», «sorted»… */
  forbidden: string[];
}

export const NO_COURSE: CourseRules = { silent: false, hideSolutions: false, forbidden: [] };

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Слово целиком, без учёта регистра: «sort» не задевает «sorted», а «Sorted» — задевает «sorted». */
const wordPattern = (word: string) => new RegExp(`(?<![\\w$])${escape(word)}(?![\\w$])`, 'gi');

const mentions = (text: string, words: string[]) => words.some((w) => wordPattern(w).test(text));

const censor = (text: string, words: string[]) =>
  words.reduce((out, w) => out.replace(wordPattern(w), '…'), text);

/** Текст Adviser без запретных слов курса: они заменяются «…». */
export const applyCourseText = (text: string, course: CourseRules) =>
  censor(
    text,
    course.forbidden.filter((w) => w.trim()),
  );

/**
 * Замечание по правилам курса: запретные слова в текстах заменяются «…», решение, которое
 * их использует, — скрывается целиком (пустой fix: кнопки «Показать решение» не будет).
 */
export function applyCourse(issue: Issue, course: CourseRules): Issue {
  const words = course.forbidden.filter((w) => w.trim());
  const hideFix =
    course.hideSolutions ||
    mentions(issue.fix.code, words) ||
    mentions(issue.fix.description, words);
  return {
    ...issue,
    hint: censor(issue.hint, words),
    explanation: censor(issue.explanation, words),
    fix: hideFix ? { description: '', code: '' } : issue.fix,
    // Пример — код: «…» его бы сломало, поэтому пример с запретным словом не показываем.
    example: issue.example && mentions(issue.example, words) ? undefined : issue.example,
  };
}
