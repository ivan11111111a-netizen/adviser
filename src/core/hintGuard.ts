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

const STRINGS = [
  String.raw`"""[\s\S]*?"""`,
  String.raw`'''[\s\S]*?'''`,
  String.raw`"(?:\\.|[^"\\\n])*"`,
  String.raw`'(?:\\.|[^'\\\n])*'`,
  String.raw`\x60(?:\\.|[^\x60\\])*\x60`,
];

/**
 * Код без комментариев и строк: слова в них — речь, а не имена. Иначе «what» из комментария
 * решения «// what if the list is empty» сочлось бы новым именем, и пропал бы любой намёк со
 * словом What. Комментарий в Python — #, а // в нём — деление нацело.
 */
export function stripCommentsAndStrings(text: string, languageId: string): string {
  const comments =
    languageId === 'python'
      ? [String.raw`#[^\n]*`]
      : [String.raw`\/\/[^\n]*`, String.raw`\/\*[\s\S]*?\*\/`];
  // Слева направо: # внутри строки — часть строки, апостроф в комментарии — часть комментария.
  return text.replace(new RegExp([...STRINGS, ...comments].join('|'), 'g'), ' ');
}

/** Что есть в решении и нет в коде: имена длиннее двух букв и «говорящие» операторы. */
export function newInFix(fixCode: string, code: string, languageId: string): string[] {
  const fix = stripCommentsAndStrings(fixCode, languageId);
  const own = stripCommentsAndStrings(code, languageId);
  // Слова из комментариев учащегося — тоже его: их появление в решении ничего не выдаёт.
  const before = identifiers(code);
  const names = [...identifiers(fix)].filter(
    (name) => name.length > 2 && !COMMON.has(name) && !before.has(name),
  );
  const operators = OPERATORS.filter((op) => fix.includes(op) && !own.includes(op));
  return [...names, ...operators];
}

/** Намёк выдаёт ответ: называет новое из решения. Возвращает, что именно, — для лога. */
export function hintLeak(
  hint: string,
  fixCode: string,
  code: string,
  languageId: string,
): string | undefined {
  const hintNames = identifiers(hint);
  return newInFix(fixCode, code, languageId).find((token) =>
    /^[A-Za-z_$]/.test(token) ? hintNames.has(token) : hint.includes(token),
  );
}
