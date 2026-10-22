import { readFileSync } from 'node:fs';
import { untranslated, type Translate } from '../../src/core/i18n';

export const ruBundle = JSON.parse(readFileSync('l10n/bundle.l10n.ru.json', 'utf8')) as Record<
  string,
  string
>;

/** Перевод на русский по l10n/bundle.l10n.ru.json, как в VS Code на русском. Нет строки — ошибка. */
export const ru: Translate = (message, ...args) => {
  const translated = ruBundle[message];
  if (translated === undefined) {
    throw new Error(`нет перевода в l10n/bundle.l10n.ru.json: ${message}`);
  }
  return untranslated(translated, ...args);
};
