import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  parseCheckCases,
  renderCheckReport,
  summarizeChecks,
  type CheckRecord,
} from '../../evals/check';

test('набор evals/check-cases.json: файлы есть, строки в пределах функции, есть и верные, и неверные ответы', () => {
  const cases = parseCheckCases(JSON.parse(readFileSync('evals/check-cases.json', 'utf8')));
  expect(cases.length).toBeGreaterThan(0);
  for (const c of cases) {
    const path = `evals/cases/${c.file}`;
    expect(existsSync(path), path).toBe(true);
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n').length;
    expect(c.issue.endLine).toBeLessThanOrEqual(lines);
    expect(c.issue.startLine).toBeLessThanOrEqual(c.issue.endLine);
    expect(new Set(c.answers.map((a) => a.understood))).toEqual(new Set([true, false]));
  }
});

const record = (expected: boolean, got?: boolean, over: Partial<CheckRecord> = {}) => ({
  file: 'js/a.js',
  answer: 'ответ',
  expected,
  got,
  seconds: 2,
  ...over,
});

test('summarizeChecks: «верно» на неверный и «не то» на верный — отдельно, утечки — среди отказов', () => {
  const s = summarizeChecks([
    record(true, true),
    record(false, true),
    record(true, false, { leak: 'Number' }),
    record(false, false),
    record(false, undefined, { error: '429', seconds: 0 }),
  ]);
  expect(s).toEqual({
    total: 5,
    failed: 1,
    correct: 2,
    falseAccepts: 1,
    falseRejects: 1,
    rejected: 2,
    leaks: 1,
    medianSeconds: 2,
  });
});

test('renderCheckReport: метрики и таблица, | в ответе не ломает её', () => {
  const md = renderCheckReport({ id: 'x', date: 'сегодня', model: 'sonnet', prompt: 'check.v1' }, [
    record(false, true, { answer: 'a | b', feedback: 'Верно.' }),
  ]);
  expect(md).toContain('| «Верно» на неверный ответ | 1 |');
  expect(md).toContain('| js/a.js | a \\| b | не понял | понял **✗** | Верно. |');
});
