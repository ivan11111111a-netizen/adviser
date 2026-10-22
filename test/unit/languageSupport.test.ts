import { expect, test } from 'vitest';
import { missingSupport } from '../../src/core/languageSupport';

test('missingSupport: Python без расширения Python — подсказка, JS — ничего не нужно', () => {
  const none = () => false;
  expect(missingSupport('python', none)).toEqual({ language: 'Python', id: 'ms-python.python' });
  expect(missingSupport('javascript', none)).toBeUndefined();
  expect(missingSupport('python', (id) => id === 'ms-python.python')).toBeUndefined();
});

test('missingSupport: для C хватает любого из двух расширений', () => {
  expect(missingSupport('c', (id) => id === 'llvm-vs-code-extensions.vscode-clangd')).toBe(
    undefined,
  );
  expect(missingSupport('c', () => false)?.id).toBe('ms-vscode.cpptools');
});
