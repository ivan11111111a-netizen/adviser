import { expect, test } from 'vitest';
import { cacheKey, LruCache } from '../../src/core/cache';

test('cacheKey зависит от каждой части и от границ между ними', () => {
  expect(cacheKey('mock', 'промпт', 'код')).toBe(cacheKey('mock', 'промпт', 'код'));
  expect(cacheKey('mock', 'промпт', 'код')).not.toBe(cacheKey('mock', 'промпт', 'код2'));
  expect(cacheKey('ab', 'c')).not.toBe(cacheKey('a', 'bc'));
});

test('LruCache вытесняет ту запись, к которой дольше всех не обращались', () => {
  const cache = new LruCache<number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  expect(cache.get('a')).toBe(1);
  cache.set('c', 3);
  expect(cache.get('b')).toBeUndefined();
  expect(cache.get('a')).toBe(1);
  expect(cache.get('c')).toBe(3);
});
