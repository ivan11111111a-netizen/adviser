import { expect, test } from 'vitest';
import { consentDetail, consentKey, isFreeTier, isLocal } from '../../src/core/consent';

const openRouter = { baseUrl: 'https://openrouter.ai/api/v1', model: 'qwen/qwen3-coder:free' };

test('isLocal: localhost и петля — да, внешний сервер и мусор — нет', () => {
  expect(isLocal('http://localhost:11434/v1')).toBe(true);
  expect(isLocal('http://127.0.0.1:1234/v1')).toBe(true);
  expect(isLocal('http://[::1]:11434/v1')).toBe(true);
  expect(isLocal('https://openrouter.ai/api/v1')).toBe(false);
  expect(isLocal('http://192.168.1.5:11434/v1')).toBe(false);
  expect(isLocal('не адрес')).toBe(false);
});

test('consentKey — сервер без пути: смена модели заново не спрашивает', () => {
  expect(consentKey(openRouter)).toBe('https://openrouter.ai');
  expect(consentKey({ ...openRouter, model: 'anthropic/claude-haiku' })).toBe(
    'https://openrouter.ai',
  );
});

test('consentDetail: куда, что уходит и не уходит, предупреждение — только для :free', () => {
  const free = consentDetail(openRouter);
  expect(free).toContain('Куда: https://openrouter.ai, модель qwen/qwen3-coder:free.');
  expect(free).toContain('.env*');
  expect(free).toContain('для обучения своих моделей');
  expect(isFreeTier({ ...openRouter, model: 'openai/gpt-5' })).toBe(false);
  expect(consentDetail({ ...openRouter, model: 'openai/gpt-5' })).not.toContain('обучения');
});
