import { expect, test } from 'vitest';
import { buildPrompt, numberLines } from '../../src/core/promptBuilder';
import { reviewJsonSchema } from '../../src/core/reviewSchema';

test('нумерует строки с единицы и выравнивает номера', () => {
  const code = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\r\n');
  const lines = numberLines(code).split('\n');
  expect(lines[0]).toBe(' 1 | l1');
  expect(lines[9]).toBe('10 | l10');
});

test('инструкция — в system, код в конце — в prompt', () => {
  const req = buildPrompt('  Ты наставник.\n', {
    languageId: 'python',
    code: 'def f():\n    pass',
  });
  expect(req.system).toBe('Ты наставник.');
  expect(req.prompt).toBe('Язык: python\n\n<code>\n1 | def f():\n2 |     pass\n</code>\n');
  expect(req.jsonSchema).toBe(reviewJsonSchema);
});
