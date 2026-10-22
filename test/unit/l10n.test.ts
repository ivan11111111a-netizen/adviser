import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { pluralForm, untranslated } from '../../src/core/i18n';
import { ruBundle } from './ru';

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith('.ts')
        ? [join(dir, e.name)]
        : [],
  );

/** Строки интерфейса: первый аргумент vscode.l10n.t(…) и t(…) в ядре. */
function messages(): { keys: Set<string>; templates: string[] } {
  const keys = new Set<string>();
  const templates: string[] = [];
  for (const file of sources('src')) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      keys.add(m[2].replace(/\\(['"\\])/g, '$1'));
    }
    // Ключ должен быть литералом: шаблонную строку бандл не найдёт.
    for (const m of text.matchAll(/\bt\(\s*`/g)) {
      templates.push(`${file}:${text.slice(0, m.index).split('\n').length}`);
    }
  }
  return { keys, templates };
}

const placeholders = (s: string) => [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();

test('у каждой строки интерфейса есть русский перевод, лишних переводов нет', () => {
  const { keys, templates } = messages();
  expect(templates).toEqual([]);
  expect([...keys].filter((k) => !(k in ruBundle))).toEqual([]);
  expect(Object.keys(ruBundle).filter((k) => !keys.has(k))).toEqual([]);
});

test('package.json: у каждого %ключа% есть английский и русский текст, лишних нет', () => {
  const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  const manifest = readFileSync('package.json', 'utf8');
  const used = new Set([...manifest.matchAll(/"%([\w.-]+)%"/g)].map((m) => m[1]));
  const en = read('package.nls.json');
  const ruNls = read('package.nls.ru.json');
  expect(Object.keys(en).sort()).toEqual([...used].sort());
  expect(Object.keys(ruNls).sort()).toEqual([...used].sort());
  // Страницы мастера на обоих языках существуют.
  for (const key of [...used].filter((k) => k.endsWith('.media'))) {
    expect(existsSync(en[key]), en[key]).toBe(true);
    expect(existsSync(ruNls[key]), ruNls[key]).toBe(true);
  }
});

test('в переводе те же места {0}, {1}…, что и в исходной строке', () => {
  const broken = Object.entries(ruBundle).filter(
    ([en, ruText]) => placeholders(en).join() !== placeholders(ruText).join(),
  );
  expect(broken).toEqual([]);
});

test('untranslated подставляет значения, pluralForm выбирает форму', () => {
  expect(untranslated('{0} of {1}, {2}', 1, 'two')).toBe('1 of two, {2}');
  expect([1, 2].map((n) => pluralForm(n, 'time|times'))).toEqual(['time', 'times']);
  expect([1, 3, 5, 11, 21].map((n) => pluralForm(n, 'раз|раза|раз'))).toEqual([
    'раз',
    'раза',
    'раз',
    'раз',
    'раз',
  ]);
  expect([1, 2, 5].map((n) => pluralForm(n, 'день|дня|дней'))).toEqual(['день', 'дня', 'дней']);
});
