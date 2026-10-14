/** Диапазон строк файла, с нуля, включительно. */
export interface LineRange {
  start: number;
  end: number;
}

/** Символ документа в виде данных: ядро не импортирует vscode, адаптер переводит DocumentSymbol сюда. */
export interface SymbolNode extends LineRange {
  name: string;
  kind: number;
  children: SymbolNode[];
}

/** Функция документа. key — путь имён (Класс.метод): по нему автопилот узнаёт функцию после правок. */
export interface FunctionRange extends LineRange {
  key: string;
}

// Значения vscode.SymbolKind.
export const SymbolKind = {
  Class: 4,
  Method: 5,
  Constructor: 8,
  Function: 11,
  Variable: 12,
  Constant: 13,
} as const;

export const FALLBACK_CONTEXT = 10;

const FUNCTION_KINDS: number[] = [SymbolKind.Method, SymbolKind.Constructor, SymbolKind.Function];

// Стрелочная функция в константе приходит как многострочная Variable или Constant.
const isFunctionLike = (s: SymbolNode) =>
  FUNCTION_KINDS.includes(s.kind) ||
  ((s.kind === SymbolKind.Variable || s.kind === SymbolKind.Constant) && s.end > s.start);

/**
 * Функции документа, которые разбираются целиком. Классы и прочие контейнеры проходим насквозь,
 * поэтому метод — отдельная функция, а колбэки и вложенные функции — часть своей функции
 * (TypeScript отдаёт колбэк `reduce` отдельным символом).
 */
export function functionsOf(symbols: SymbolNode[]): FunctionRange[] {
  const found: FunctionRange[] = [];
  const seen = new Map<string, number>();
  const walk = (nodes: SymbolNode[], path: string) => {
    for (const node of nodes) {
      const name = path + node.name;
      if (!isFunctionLike(node)) {
        walk(node.children, `${name}.`);
        continue;
      }
      // Перегрузки и одноимённые функции различаем по порядку.
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      found.push({ key: n > 1 ? `${name}#${n}` : name, start: node.start, end: node.end });
    }
  };
  walk(symbols, '');
  return found;
}

const contains = (range: LineRange, line: number) => line >= range.start && line <= range.end;

function innermostClass(nodes: SymbolNode[], line: number): SymbolNode | undefined {
  const node = nodes.find((n) => contains(n, line));
  if (!node) {
    return undefined;
  }
  return innermostClass(node.children, line) ?? (node.kind === SymbolKind.Class ? node : undefined);
}

/**
 * Что разбирать для курсора на строке line: функцию или метод, иначе класс,
 * иначе строки вокруг курсора (±FALLBACK_CONTEXT), если языковой сервер не дал символов.
 */
export function pickRange(symbols: SymbolNode[], line: number, lineCount: number): LineRange {
  const found =
    functionsOf(symbols).find((f) => contains(f, line)) ?? innermostClass(symbols, line);
  if (found) {
    return { start: found.start, end: found.end };
  }
  return {
    start: Math.max(0, line - FALLBACK_CONTEXT),
    end: Math.min(lineCount - 1, line + FALLBACK_CONTEXT),
  };
}

/** Строки замечания считаются от начала функции (1); переводим в строки файла и не выпускаем за функцию. */
export function toFileLines(
  issue: { startLine: number; endLine: number },
  range: LineRange,
): LineRange {
  const clamp = (n: number) => Math.min(range.end, Math.max(range.start, range.start + n - 1));
  const start = clamp(issue.startLine);
  return { start, end: Math.max(start, clamp(issue.endLine)) };
}
