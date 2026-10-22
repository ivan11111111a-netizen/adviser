import { describe, expect, test } from 'vitest';
import { buildJudgeRequest, judgedIndexes, judgeHints } from '../../evals/judge';
import { InvalidResponseError, type Provider } from '../../src/core/engine';
import type { Issue } from '../../src/core/reviewSchema';
import { mockReview } from '../../src/providers/mock';

const issue = (severity: Issue['severity'], hint: string): Issue => ({
  ...mockReview.issues[0],
  severity,
  hint,
});
const issues = [
  { ...issue('critical', 'нет'), category: 'security' as const },
  issue('warning', 'Что вернёт?'),
  issue('suggestion', 'А имя?'),
];

const scripted = (...answers: unknown[]): Provider => ({
  complete: async () => {
    const next = answers.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next;
  },
});

test('уязвимость не оценивается: учащийся видит сразу объяснение', () => {
  expect(judgedIndexes(issues)).toEqual([1, 2]);
});

test('в запросе код с номерами строк и намёки с их номерами, объяснением и решением', () => {
  const req = buildJudgeRequest(' Судья. ', 'python', 'def f():\n    pass', issues);
  expect(req.system).toBe('Судья.');
  expect(req.prompt).toContain('<code>\n1 | def f():\n2 |     pass\n</code>');
  expect(req.prompt).toContain('[1] Проблема: Mock-объяснение');
  expect(req.prompt).toContain('    Намёк: А имя?');
  expect(req.prompt).not.toContain('[0]');
});

describe('judgeHints', () => {
  const req = buildJudgeRequest('Судья.', 'js', '', issues);
  const judgment = (index: number) => ({ index, leaks: false, guides: true, comment: 'ок' });

  test('оценки чужих номеров и повторы отбрасываются, порядок по номеру', async () => {
    const answer = { hints: [judgment(2), judgment(0), judgment(1), judgment(2), judgment(7)] };
    expect(await judgeHints(scripted(answer), req, issues)).toEqual({
      ok: true,
      judgments: [judgment(1), judgment(2)],
    });
  });

  test('ответ не по схеме — один повтор', async () => {
    const result = await judgeHints(
      scripted(new InvalidResponseError('не JSON'), { hints: [judgment(1)] }),
      req,
      issues,
    );
    expect(result).toEqual({ ok: true, judgments: [judgment(1)] });
    expect((await judgeHints(scripted({}, {}), req, issues)).ok).toBe(false);
  });

  test('сетевая ошибка без повтора', async () => {
    const result = await judgeHints(scripted(new Error('429'), { hints: [] }), req, issues);
    expect(result).toEqual({ ok: false, error: '429' });
  });
});
