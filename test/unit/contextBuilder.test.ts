import { describe, expect, test } from 'vitest';
import { SymbolKind, type SymbolNode } from '../../src/core/codeRange';
import {
  buildContext,
  npmDependencies,
  pythonRequirements,
  skeleton,
} from '../../src/core/contextBuilder';

const sym = (
  name: string,
  kind: number,
  start: number,
  end: number,
  children: SymbolNode[] = [],
) => ({
  name,
  kind,
  start,
  end,
  children,
});

const lines = [
  "import { readFile } from 'node:fs/promises';",
  "const lodash = require('lodash');",
  '',
  'export function load(path) {',
  '  return readFile(path, "utf8");',
  '}',
  '',
  'class Cart {',
  '  add(item) {',
  '    this.items.push(item);',
  '  }',
  '  total() {',
  '    return 0;',
  '  }',
  '}',
];
const symbols = [
  sym('load', SymbolKind.Function, 3, 5),
  sym('Cart', SymbolKind.Class, 7, 14, [
    sym('add', SymbolKind.Method, 8, 10),
    sym('total', SymbolKind.Method, 11, 13),
  ]),
];

describe('skeleton', () => {
  test('импорты и первые строки соседей, разбираемая функция пропущена', () => {
    expect(
      skeleton({ lines, languageId: 'javascript', range: { start: 11, end: 13 }, symbols }),
    ).toEqual([
      "1 | import { readFile } from 'node:fs/promises';",
      "2 | const lodash = require('lodash');",
      '4 | export function load(path) { …',
      '9 |   add(item) { …',
    ]);
  });

  test('первые строки констант в скелет не идут: в значении бывает ключ', () => {
    const withSecret = ['const API_KEY = "sk-secret";', 'function f() {', '  return 1;', '}'];
    expect(
      skeleton({
        lines: withSecret,
        languageId: 'javascript',
        range: { start: 1, end: 3 },
        symbols: [sym('API_KEY', SymbolKind.Constant, 0, 0)],
      }),
    ).toEqual([]);
  });

  test('Python: import и from … import', () => {
    const py = ['import os', 'from pathlib import Path', 'x = 1', 'def f():', '    pass'];
    expect(
      skeleton({ lines: py, languageId: 'python', range: { start: 3, end: 4 }, symbols: [] }),
    ).toEqual(['1 | import os', '2 | from pathlib import Path']);
  });
});

describe('buildContext', () => {
  const input = {
    lines,
    languageId: 'javascript',
    range: { start: 8, end: 10 },
    symbols,
    diagnostics: [{ line: 9, message: "'items' is possibly undefined", source: 'ts' }],
    dependencies: { lodash: '^4.17.21', '@types/node': '^22.0.0' },
  };

  test('замечания инструментов (строки от начала функции), скелет, зависимости', () => {
    expect(buildContext(input)).toBe(
      [
        'Уже нашли линтер и компилятор:',
        "- строка 2: 'items' is possibly undefined (ts)",
        '',
        'Остальной файл (без тел функций):',
        "1 | import { readFile } from 'node:fs/promises';",
        "2 | const lodash = require('lodash');",
        '4 | export function load(path) { …',
        '12 |   total() { …',
        '',
        'Зависимости проекта: @types/node ^22.0.0, lodash ^4.17.21',
      ].join('\n'),
    );
  });

  test('не влезает в бюджет — отрезаем хвост по целой строке', () => {
    const text = buildContext(input, 120);
    expect(text.length).toBeLessThanOrEqual(122);
    expect(text).toMatch(/^Уже нашли линтер и компилятор:\n.*\n…$/s);
  });

  test('ничего нет — пустая строка', () => {
    expect(
      buildContext({ ...input, lines: ['x'], symbols: [], diagnostics: [], dependencies: {} }),
    ).toBe('');
  });
});

test('npmDependencies: dependencies поверх devDependencies, битый файл — пусто', () => {
  expect(
    npmDependencies(
      '{"dependencies":{"ai":"^7.0.0"},"devDependencies":{"vitest":"^5.0.0","ai":"x"}}',
    ),
  ).toEqual({ ai: '^7.0.0', vitest: '^5.0.0' });
  expect(npmDependencies('{ broken')).toEqual({});
});

test('pythonRequirements: версии, extras, комментарии, опции', () => {
  expect(
    pythonRequirements(
      'requests==2.32.0\n# комментарий\nnumpy>=1.26  # для массивов\nrich[jupyter]\n-r dev.txt\n',
    ),
  ).toEqual({ requests: '==2.32.0', numpy: '>=1.26', rich: '*' });
});
