/** Диапазон строк файла, с нуля, включительно. */
export interface LineRange {
  start: number;
  end: number;
}

/** Символ документа в виде данных: ядро не импортирует vscode, адаптер переводит DocumentSymbol сюда. */
export interface SymbolNode extends LineRange {
  kind: number;
  children: SymbolNode[];
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
 * Первая сверху функция на пути к курсору. Классы и прочие контейнеры проходим насквозь,
 * поэтому метод берётся целиком, а колбэки и вложенные функции — вместе со своей функцией
 * (TypeScript отдаёт колбэк `reduce` отдельным символом).
 */
function outermostFunction(nodes: SymbolNode[], line: number): SymbolNode | undefined {
  const node = nodes.find((n) => line >= n.start && line <= n.end);
  if (!node) {
    return undefined;
  }
  return isFunctionLike(node) ? node : outermostFunction(node.children, line);
}

function innermostClass(nodes: SymbolNode[], line: number): SymbolNode | undefined {
  const node = nodes.find((n) => line >= n.start && line <= n.end);
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
  const found = outermostFunction(symbols, line) ?? innermostClass(symbols, line);
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
