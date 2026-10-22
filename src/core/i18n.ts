import { plural } from './plural';

/**
 * Перевод строки интерфейса. Исходные строки — английские, русские лежат в
 * l10n/bundle.l10n.ru.json. В расширении это vscode.l10n.t, в ядре его передают параметром:
 * ядро не импортирует vscode. Места для значений — {0}, {1}…
 */
export type Translate = (message: string, ...args: (string | number)[]) => string;

/** Без перевода: только подстановка {0}, {1}… Для английского интерфейса и тестов. */
export const untranslated: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (match, i: string) =>
    Number(i) < args.length ? String(args[Number(i)]) : match,
  );

/**
 * Форма слова при числе. forms — переведённая строка вида «time|times» (английский: одна и
 * много) или «раз|раза|раз» (русский: один, два–четыре, пять).
 */
export function pluralForm(n: number, forms: string): string {
  const [one, few, many] = forms.split('|');
  if (many !== undefined) {
    return plural(n, one, few, many);
  }
  return n === 1 ? one : (few ?? one);
}
