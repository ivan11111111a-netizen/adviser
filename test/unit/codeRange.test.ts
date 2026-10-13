import { describe, expect, test } from 'vitest';
import { pickRange, SymbolKind, toFileLines, type SymbolNode } from '../../src/core/codeRange';

const sym = (kind: number, start: number, end: number, children: SymbolNode[] = []) => ({
  kind,
  start,
  end,
  children,
});

describe('pickRange', () => {
  const method = sym(SymbolKind.Method, 3, 8);
  const tree = [
    sym(SymbolKind.Function, 0, 1),
    sym(SymbolKind.Class, 2, 12, [sym(SymbolKind.Variable, 2, 2), method]),
    sym(SymbolKind.Constant, 14, 18),
  ];

  test('метод внутри класса', () => {
    expect(pickRange(tree, 5, 100)).toEqual({ start: 3, end: 8 });
  });

  test('класс, если курсор в нём, но вне методов', () => {
    expect(pickRange(tree, 10, 100)).toEqual({ start: 2, end: 12 });
  });

  test('многострочная константа — стрелочная функция', () => {
    expect(pickRange(tree, 15, 100)).toEqual({ start: 14, end: 18 });
  });

  test('колбэк и вложенная функция разбираются вместе с внешней функцией', () => {
    const callback = sym(SymbolKind.Function, 3, 3);
    const outer = sym(SymbolKind.Function, 2, 20, [callback, sym(SymbolKind.Function, 5, 9)]);
    expect(pickRange([outer], 3, 100)).toEqual({ start: 2, end: 20 });
    expect(pickRange([outer], 6, 100)).toEqual({ start: 2, end: 20 });
  });

  test('класс внутри функции не отбирает её', () => {
    const outer = sym(SymbolKind.Function, 0, 20, [sym(SymbolKind.Class, 2, 10)]);
    expect(pickRange([outer], 5, 100)).toEqual({ start: 0, end: 20 });
  });

  test('без символов — ±10 строк, в границах файла', () => {
    expect(pickRange([], 3, 100)).toEqual({ start: 0, end: 13 });
    expect(pickRange([], 50, 55)).toEqual({ start: 40, end: 54 });
  });
});

describe('toFileLines', () => {
  const fn = { start: 10, end: 14 };

  test('строка 1 — первая строка функции', () => {
    expect(toFileLines({ startLine: 1, endLine: 2 }, fn)).toEqual({ start: 10, end: 11 });
  });

  test('номера за пределами функции прижимаются к её границам', () => {
    expect(toFileLines({ startLine: 4, endLine: 99 }, fn)).toEqual({ start: 13, end: 14 });
    expect(toFileLines({ startLine: 3, endLine: 1 }, fn)).toEqual({ start: 12, end: 12 });
  });
});
