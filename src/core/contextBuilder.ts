import { isFunctionLike, SymbolKind, type LineRange, type SymbolNode } from './codeRange';

/** Окружение функции (6.3 плана): помогает модели не советовать то, чего нет в проекте. */
export interface ContextInput {
  /** Строки файла. */
  lines: string[];
  languageId: string;
  /** Разбираемые строки: их нет в скелете, номера замечаний считаются от их начала. */
  range: LineRange;
  symbols: SymbolNode[];
  /** Замечания линтера и компилятора в разбираемых строках, без своих. */
  diagnostics: { line: number; message: string; source?: string }[];
  /** Зависимости проекта: имя → версия. */
  dependencies: Record<string, string>;
  /** Первые строки функций из других файлов проекта, которые разбираемая функция вызывает. */
  calls?: string[];
}

/** Сколько вызываемых функций искать: каждая — запрос к языковому серверу. */
export const MAX_CALLS = 8;

const NOT_CALLS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'typeof',
  'await',
  'new',
  'super',
  'def',
  'print',
  'elif',
  'with',
  'not',
  'and',
  'or',
  'in',
]);

/** Вызовы в разбираемых строках: имя и где оно впервые встретилось. */
export function callSites(
  lines: string[],
  range: LineRange,
): { name: string; line: number; character: number }[] {
  const found = new Map<string, { name: string; line: number; character: number }>();
  for (let line = range.start; line <= range.end && found.size < MAX_CALLS; line++) {
    for (const m of (lines[line] ?? '').matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
      // Определение самой функции и её вложенных — не вызов.
      const before = lines[line].slice(0, m.index).trimEnd();
      if (NOT_CALLS.has(m[1]) || found.has(m[1]) || /\b(function|def)$/.test(before)) {
        continue;
      }
      found.set(m[1], { name: m[1], line, character: m.index });
      if (found.size >= MAX_CALLS) {
        break;
      }
    }
  }
  return [...found.values()];
}

/** Примерно 6 000 токенов на весь запрос (6.3 плана); на окружение — малая часть. */
export const CONTEXT_BUDGET = 4000;
const MAX_IMPORTS = 15;
const MAX_DEPENDENCIES = 40;

const IMPORT: Record<string, RegExp> = {
  python: /^\s*(import\s|from\s+\S+\s+import\s)/,
  js: /^\s*(import\s|export\s.*\sfrom\s|(const|let|var)\s.*=\s*require\()/,
};

const CONTAINERS: number[] = [SymbolKind.Class];

/**
 * Скелет файла: импорты и первые строки соседних функций и классов, без тел.
 * Разбираемая функция в скелет не входит — она и так в <code>.
 */
export function skeleton(input: Pick<ContextInput, 'lines' | 'languageId' | 'range' | 'symbols'>) {
  const { lines, range } = input;
  const imports = lines
    .map((text, line) => ({ text, line }))
    .filter(({ text }) => (IMPORT[input.languageId] ?? IMPORT.js).test(text))
    .slice(0, MAX_IMPORTS);
  const outside = (s: SymbolNode) => s.end < range.start || s.start > range.end;
  const heads: { text: string; line: number }[] = [];
  const walk = (nodes: SymbolNode[]) => {
    for (const node of nodes) {
      // Только функции и классы: первая строка константы — это часто её значение, а в нём бывает ключ.
      const head = isFunctionLike(node) || node.kind === SymbolKind.Class;
      if (head && outside(node)) {
        heads.push({ text: `${lines[node.start]?.trimEnd()} …`, line: node.start });
      }
      // В класс заходим и тогда, когда разбираемый метод внутри него: соседние методы — тоже окружение.
      if (CONTAINERS.includes(node.kind)) {
        walk(node.children);
      }
    }
  };
  walk(input.symbols);
  // Экспорт функции — и импорт, и её первая строка: оставляем одну.
  const byLine = new Map([...imports, ...heads].map((h) => [h.line, h.text]));
  return [...byLine].sort(([a], [b]) => a - b).map(([line, text]) => `${line + 1} | ${text}`);
}

/**
 * Окружение для промпта: замечания инструментов, скелет, зависимости — по важности,
 * пока влезает в бюджет. Пустая строка — окружения нет.
 */
export function buildContext(input: ContextInput, budget = CONTEXT_BUDGET): string {
  const sections: string[] = [];
  if (input.diagnostics.length) {
    // Номера — от начала функции, как в <code>.
    const items = input.diagnostics.map(
      (d) =>
        `- строка ${d.line - input.range.start + 1}: ${d.message}${d.source ? ` (${d.source})` : ''}`,
    );
    sections.push(`Уже нашли линтер и компилятор:\n${items.join('\n')}`);
  }
  const files = skeleton(input);
  if (files.length) {
    sections.push(`Остальной файл (без тел функций):\n${files.join('\n')}`);
  }
  if (input.calls?.length) {
    sections.push(`Что функция вызывает из других файлов:\n${input.calls.join('\n')}`);
  }
  const deps = Object.entries(input.dependencies)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_DEPENDENCIES)
    .map(([name, version]) => `${name} ${version}`);
  if (deps.length) {
    sections.push(`Зависимости проекта: ${deps.join(', ')}`);
  }

  // Разделы идут по важности, поэтому при нехватке места отрезаем хвост по целой строке.
  const text = sections.join('\n\n');
  if (text.length <= budget) {
    return text;
  }
  const cut = text.slice(0, budget);
  return `${cut.slice(0, cut.lastIndexOf('\n'))}\n…`;
}

/** Версии из package.json: dependencies и devDependencies. */
export function npmDependencies(packageJson: string): Record<string, string> {
  try {
    const pkg = JSON.parse(packageJson) as Record<string, unknown>;
    const pick = (field: string) =>
      typeof pkg[field] === 'object' && pkg[field] !== null
        ? (pkg[field] as Record<string, unknown>)
        : {};
    return Object.fromEntries(
      Object.entries({ ...pick('devDependencies'), ...pick('dependencies') }).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      ),
    );
  } catch {
    // Битый package.json — просто без версий: окружение необязательно.
    return {};
  }
}

/** Версии из requirements.txt: «пакет==1.2», «пакет>=1.0»; без версии — «*». */
export function pythonRequirements(text: string): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z0-9][\w.-]*)(\[[^\]]*\])?\s*([<>=!~].*)?$/.exec(line);
    if (m && !line.startsWith('-')) {
      deps[m[1]] = m[3]?.trim() ?? '*';
    }
  }
  return deps;
}
