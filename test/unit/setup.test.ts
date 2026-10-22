import { expect, test } from 'vitest';
import { ru } from './ru';
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
  expect(checkOpenRouterModel('  ', ru)).toBe('укажи модель');
  expect(checkOpenRouterModel('  ')).toBe('enter a model');
  expect(checkOpenRouterModel('qwen3-coder', ru)).toMatch(/автор\/модель/);
});
