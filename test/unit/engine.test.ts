import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  InvalidResponseError,
  runReview,
  runStructured,
  type Provider,
} from '../../src/core/engine';
import type { Issue } from '../../src/core/reviewSchema';
import { mockReview } from '../../src/providers/mock';

const request = { system: 's', prompt: 'p', jsonSchema: {} };

/** Провайдер, который по очереди отдаёт заготовленные ответы; Error из списка бросается. */
function scripted(...answers: unknown[]): Provider & { calls: number } {
  const p = {
    calls: 0,
    async complete() {
      const a = answers[p.calls++];
      if (a instanceof Error) {
        throw a;
      }
      return a;
    },
  };
  return p;
}

const issue = (over: Partial<Issue>): Issue => ({ ...mockReview.issues[0], ...over });

test('runStructured: любая схема, тот же один повтор', async () => {
  const schema = z.object({ understood: z.boolean() });
  const p = scripted({ understood: 'да' }, { understood: true });
  expect(await runStructured(schema, p, request)).toEqual({ ok: true, data: { understood: true } });
  expect(p.calls).toBe(2);
});

describe('runReview', () => {
  test('возвращает валидный ответ с первой попытки', async () => {
    const p = scripted(mockReview);
    expect(await runReview(p, request)).toEqual({ ok: true, review: mockReview });
    expect(p.calls).toBe(1);
  });

  test('«замечаний нет» — нормальный ответ', async () => {
    const empty = { summary: 'Всё хорошо', issues: [] };
    expect(await runReview(scripted(empty), request)).toEqual({ ok: true, review: empty });
  });

  test('ответ не по схеме — один повтор', async () => {
    const p = scripted({ summary: 1 }, mockReview);
    expect((await runReview(p, request)).ok).toBe(true);
    expect(p.calls).toBe(2);
  });

  test('не JSON от провайдера — тоже повтор', async () => {
    const p = scripted(new InvalidResponseError('не JSON'), mockReview);
    expect((await runReview(p, request)).ok).toBe(true);
    expect(p.calls).toBe(2);
  });

  test('после второго невалидного ответа — ошибка без третьей попытки', async () => {
    const p = scripted({ summary: 1 }, { issues: 'нет' }, mockReview);
    const result = await runReview(p, request);
    expect(!result.ok && result.invalid).toBe(true);
    expect(p.calls).toBe(2);
  });

  test('ошибка сети не повторяется движком', async () => {
    const p = scripted(new Error('429 Too Many Requests'), mockReview);
    expect(await runReview(p, request)).toEqual({
      ok: false,
      error: '429 Too Many Requests',
      invalid: false,
    });
    expect(p.calls).toBe(1);
  });

  test('отбрасывает неуверенные и оставляет 3 лучших: серьёзные первыми', async () => {
    const review = {
      summary: '',
      issues: [
        issue({ patternId: 'a', severity: 'suggestion', confidence: 0.99 }),
        issue({ patternId: 'b', severity: 'critical', confidence: 0.6 }),
        issue({ patternId: 'c', severity: 'warning', confidence: 0.4 }),
        issue({ patternId: 'd', severity: 'warning', confidence: 0.7 }),
        issue({ patternId: 'e', severity: 'warning', confidence: 0.9 }),
      ],
    };
    const result = await runReview(scripted(review), request);
    expect(result.ok && result.review.issues.map((i) => i.patternId)).toEqual(['b', 'e', 'd']);
  });
});
