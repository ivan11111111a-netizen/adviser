/**
 * Фильтр утечек (как в CodeHelp): намёк не должен называть то, что появляется только в решении.
 * Новые для кода учащегося имена и операторы из fix — это и есть ответ: «enumerate», «===»,
 * «Number.EPSILON». Если намёк их называет, его не показываем — сразу объяснение.
 */

/** Слова языка и общие имена: их появление в решении ничего не выдаёт. */
const COMMON = new Set(
  [
    'const let var function return if else for while do break continue new this class async await',
    'try catch finally throw typeof instanceof null undefined true false def in not and or is',
    'None True False self pass elif with as import from raise except lambda yield string number',
    'boolean void any int str float list dict len print console log error result value item items',
    'length Error export default type interface public private static char double long bool auto',
    'unsigned include std main',
  ]
    .join(' ')
    .split(' '),
);

/** Операторы, которые сами по себе — исправление: строгое сравнение, «?.», «??». */
const OPERATORS = ['===', '!==', '?.', '??', '??=', '//', '**'];

const identifiers = (text: string) => new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []);

/** Что есть в решении и нет в коде: имена длиннее двух букв и «говорящие» операторы. */
export function newInFix(fixCode: string, code: string): string[] {
  const before = identifiers(code);
  const names = [...identifiers(fixCode)].filter(
    (name) => name.length > 2 && !COMMON.has(name) && !before.has(name),
  );
  const operators = OPERATORS.filter((op) => fixCode.includes(op) && !code.includes(op));
  return [...names, ...operators];
}

/** Намёк выдаёт ответ: называет новое из решения. Возвращает, что именно, — для лога. */
export function hintLeak(hint: string, fixCode: string, code: string): string | undefined {
  const hintNames = identifiers(hint);
  return newInFix(fixCode, code).find((token) =>
    /^[A-Za-z_$]/.test(token) ? hintNames.has(token) : hint.includes(token),
  );
}
