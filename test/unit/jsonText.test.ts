import { expect, test } from 'vitest';
import { extractJson } from '../../src/core/jsonText';

test('extractJson: чистый JSON, в обёртке ```json и с фразами вокруг', () => {
  expect(extractJson('{"summary":"ок","issues":[]}')).toEqual({ summary: 'ок', issues: [] });
  expect(extractJson('```json\n{"a": {"b": 1}}\n```')).toEqual({ a: { b: 1 } });
  expect(extractJson('Вот разбор:\n{"a": 1}\nУдачи!')).toEqual({ a: 1 });
});

test('extractJson: нет JSON или он битый — undefined', () => {
  expect(extractJson('Замечаний нет.')).toBeUndefined();
  expect(extractJson('{"a": 1,}')).toBeUndefined();
});
