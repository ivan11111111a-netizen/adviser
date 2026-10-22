import { expect, test } from 'vitest';
import { reindent } from '../../src/core/applyFix';

test('reindent: общий отступ убирается, ставится отступ места, вложенность сохраняется', () => {
  const fix = 'if (items.length === 0) {\n  return 0;\n}\n';
  expect(reindent(fix, '    ')).toBe('    if (items.length === 0) {\n      return 0;\n    }');
});

test('reindent: лишний отступ модели и пустые строки', () => {
  expect(reindent('        a();\n\n        b();', '  ')).toBe('  a();\n\n  b();');
  expect(reindent('', '  ')).toBe('');
});
