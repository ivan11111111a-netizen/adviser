import { expect, test } from 'vitest';
import { InvalidResponseError } from '../../src/core/engine';
import { parseClaudeOutput, parseClaudeUsage } from '../../src/providers/claudeCode';

test('расход: входные токены вместе с кэшем', () => {
  const out = JSON.stringify({
    structured_output: {},
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 3000,
      cache_creation_input_tokens: 200,
      output_tokens: 450,
    },
  });
  expect(parseClaudeUsage(out)).toEqual({ inputTokens: 3210, outputTokens: 450 });
  expect(parseClaudeUsage('не JSON')).toBeUndefined();
  expect(parseClaudeUsage('{}')).toBeUndefined();
});

test('берёт ответ из structured_output', () => {
  const out = JSON.stringify({ is_error: false, result: '', structured_output: { summary: 'ok' } });
  expect(parseClaudeOutput(out)).toEqual({ summary: 'ok' });
});

test('не JSON или нет structured_output — повод для повтора', () => {
  expect(() => parseClaudeOutput('Error: something')).toThrow(InvalidResponseError);
  expect(() => parseClaudeOutput(JSON.stringify({ is_error: false, result: 'текст' }))).toThrow(
    InvalidResponseError,
  );
});

test('is_error (например, исчерпан лимит подписки) — ошибка без повтора', () => {
  const out = JSON.stringify({ is_error: true, result: 'usage limit reached' });
  expect(() => parseClaudeOutput(out)).toThrow('claude: usage limit reached');
  expect(() => parseClaudeOutput(out)).not.toThrow(InvalidResponseError);
});
