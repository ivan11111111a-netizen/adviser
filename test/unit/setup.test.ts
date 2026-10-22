import { expect, test } from 'vitest';
import { checkOpenRouterModel, parseModelList } from '../../src/core/setup';

test('parseModelList: id из data, отсортированы; мусор — пустой список', () => {
  expect(
    parseModelList({
      object: 'list',
      data: [{ id: 'qwen2.5-coder:14b' }, { id: 'gpt-oss:20b' }, { name: 'без id' }, null],
    }),
  ).toEqual(['gpt-oss:20b', 'qwen2.5-coder:14b']);
  expect(parseModelList({ error: 'nope' })).toEqual([]);
  expect(parseModelList('text')).toEqual([]);
});

test('checkOpenRouterModel', () => {
  expect(checkOpenRouterModel('qwen/qwen3-coder:free')).toBeUndefined();
  expect(checkOpenRouterModel('  ')).toBe('укажи модель');
  expect(checkOpenRouterModel('qwen3-coder')).toMatch(/автор\/модель/);
});
