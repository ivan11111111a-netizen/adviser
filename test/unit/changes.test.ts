import { describe, expect, test } from 'vitest';
import {
  DocumentChanges,
  fingerprint,
  shiftRange,
  type FunctionCode,
} from '../../src/core/changes';

describe('fingerprint', () => {
  test('пустые строки, комментарии и пробелы не меняют смысла', () => {
    const before = 'function f(a) {\n  return a + 1;\n}';
    const after =
      'function f(a)  {\n\n  // прибавляем\n  /* единицу\n   * к числу */\n    return a + 1;   \n}';
    expect(fingerprint(after, 'javascript')).toBe(fingerprint(before, 'javascript'));
  });

  test('код меняет', () => {
    expect(fingerprint('return a + 1;', 'javascript')).not.toBe(
      fingerprint('return a - 1;', 'javascript'),
    );
  });

  test('# в JavaScript — не комментарий, а приватное поле', () => {
    expect(fingerprint('#count = 0;', 'javascript')).toBe('#count = 0;');
    expect(fingerprint('# счётчик', 'python')).toBe('');
  });

  test('в Python отступ — часть смысла', () => {
    const inLoop = 'for x in items:\n    total += x\n    print(total)';
    const afterLoop = 'for x in items:\n    total += x\nprint(total)';
    expect(fingerprint(inLoop, 'python')).not.toBe(fingerprint(afterLoop, 'python'));
    expect(fingerprint(inLoop, 'javascript')).toBe(fingerprint(afterLoop, 'javascript'));
  });
});

describe('shiftRange', () => {
  const fn = { start: 10, end: 14 };

  test('правка выше сдвигает, ниже — не трогает', () => {
    expect(shiftRange(fn, [{ start: 2, end: 2, newLines: 3 }])).toEqual({ start: 12, end: 16 });
    expect(shiftRange(fn, [{ start: 20, end: 25, newLines: 1 }])).toEqual(fn);
  });

  test('правка внутри — undefined', () => {
    expect(shiftRange(fn, [{ start: 14, end: 14, newLines: 1 }])).toBeUndefined();
    expect(shiftRange(fn, [{ start: 5, end: 10, newLines: 1 }])).toBeUndefined();
  });

  test('несколько правок одного события даны по тексту до события', () => {
    const edits = [
      { start: 1, end: 1, newLines: 2 },
      { start: 5, end: 7, newLines: 1 },
    ];
    expect(shiftRange(fn, edits)).toEqual({ start: 9, end: 13 });
  });
});

/** Документ из строк: функции заданы ключом и диапазоном, код берётся из строк. */
function doc(lines: string[], ranges: Record<string, [number, number]>): FunctionCode[] {
  return Object.entries(ranges).map(([key, [start, end]]) => ({
    key,
    start,
    end,
    code: lines.slice(start, end + 1).join('\n'),
  }));
}

describe('DocumentChanges', () => {
  const lines = ['function a() {', '  return 1;', '}', 'function b() {', '  return 2;', '}'];
  const ranges: Record<string, [number, number]> = { a: [0, 2], b: [3, 5] };

  test('изменённая функция — только та, где правили', () => {
    const changes = new DocumentChanges('javascript');
    changes.changed(doc(lines, ranges));
    const edited = [...lines];
    edited[4] = '  return 3;';
    changes.edit([{ start: 4, end: 4, newLines: 1 }]);
    expect(changes.changed(doc(edited, ranges)).map((f) => f.key)).toEqual(['b']);
  });

  test('правка только в комментариях и пробелах — не изменение, тронутые строки забываются', () => {
    const changes = new DocumentChanges('javascript');
    changes.changed(doc(lines, ranges));
    const edited = [...lines];
    edited.splice(1, 0, '  // единица');
    changes.edit([{ start: 1, end: 1, newLines: 2 }]);
    expect(changes.changed(doc(edited, { a: [0, 3], b: [4, 6] }))).toEqual([]);
    expect(changes.hasTouched).toBe(false);
  });

  test('функцию, которую не видели до правки, считаем изменённой', () => {
    const changes = new DocumentChanges('javascript');
    changes.edit([{ start: 4, end: 4, newLines: 1 }]);
    expect(changes.changed(doc(lines, ranges)).map((f) => f.key)).toEqual(['b']);
  });

  test('разобранная автопилотом: изменилась снова — есть время разбора для cooldown', () => {
    const changes = new DocumentChanges('javascript');
    changes.edit([{ start: 4, end: 4, newLines: 1 }]);
    const [b] = changes.changed(doc(lines, ranges));
    changes.reviewed(b.code, 1000, 'b');
    expect(changes.changed(doc(lines, ranges))).toEqual([]);

    const edited = [...lines];
    edited[4] = '  return 4;';
    changes.edit([{ start: 4, end: 4, newLines: 1 }]);
    expect(changes.changed(doc(edited, ranges))).toEqual([
      { key: 'b', start: 3, end: 5, code: edited.slice(3).join('\n'), reviewedAt: 1000 },
    ]);
  });

  test('разобранная командой — узнаётся по коду', () => {
    const changes = new DocumentChanges('javascript');
    changes.edit([{ start: 1, end: 1, newLines: 1 }]);
    changes.reviewed(lines.slice(0, 3).join('\n'), 1000);
    expect(changes.changed(doc(lines, ranges))).toEqual([]);
  });

  test('тронутые строки едут вместе с текстом', () => {
    const changes = new DocumentChanges('javascript');
    changes.changed(doc(lines, ranges));
    const edited = [...lines];
    edited[4] = '  return 3;';
    changes.edit([{ start: 4, end: 4, newLines: 1 }]);
    // Над функциями вставили две строки: b теперь 5..7, правленая строка — 6.
    const shifted = ['// файл', '', ...edited];
    changes.edit([{ start: 0, end: 0, newLines: 3 }]);
    expect(changes.changed(doc(shifted, { a: [2, 4], b: [5, 7] })).map((f) => f.key)).toEqual([
      'b',
    ]);
  });
});
