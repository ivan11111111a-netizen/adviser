import { describe, expect, test } from 'vitest';
import { entropy, MASK, redact } from '../../src/core/redact';

describe('redact', () => {
  test.each([
    ['AWS', 'const id = "AKIAIOSFODNN7EXAMPLE";'],
    ['GitHub', "token: 'ghp_" + 'a1B2'.repeat(9) + "'"],
    ['OpenAI', 'client = OpenAI(api_key="sk-proj-' + 'Xy9'.repeat(10) + '")'],
    ['Stripe', 'stripe(`sk_live_' + '4eC39HqLyjWDarjtT1zdp7dc' + '`)'],
    [
      'JWT',
      'h = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"',
    ],
  ])('%s: ключ скрыт', (_, line) => {
    const { text, count } = redact(line);
    expect(text).toContain(MASK);
    expect(count).toBeGreaterThan(0);
  });

  test('присваивание переменной с «секретным» именем', () => {
    expect(redact('DB_PASSWORD = "hunter2!"').text).toBe(`DB_PASSWORD = "${MASK}"`);
    expect(redact("const apiKey = 'abcd1234';").text).toBe(`const apiKey = '${MASK}';`);
    expect(redact('{ secret: "my secret value" }').text).toBe(`{ secret: "${MASK}" }`);
  });

  test('сравнение и ввод не трогаем: это логика, которую разбирают', () => {
    const code = [
      'if password == "12345":',
      '  token = input("Token: ")',
      'const label = "Введите пароль";',
    ].join('\n');
    expect(redact(code)).toEqual({ text: code, count: 0 });
  });

  test('логин и пароль в адресе', () => {
    expect(redact("connect('postgres://admin:s3cr3t@db:5432/app')").text).toBe(
      `connect('postgres://${MASK}@db:5432/app')`,
    );
  });

  test('строка с высокой энтропией скрыта, длинное обычное слово и адрес — нет', () => {
    expect(redact('key = "q8Zr2LmP0vX7nB4tK9sW1yE6uA3cJ5hD"').text).toBe(`key = "${MASK}"`);
    const normal = 'url = "https://example.com/very/long/path/to/resource/1234"';
    expect(redact(normal).text).toBe(normal);
    expect(redact('msg = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"').text).toContain('aaaa');
  });

  test('приватный ключ: строки на месте, номера строк не съезжают', () => {
    const pem = [
      'const key = `-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA1234567890',
      'abcdefghijklmnopqrstuvwxyz',
      '-----END RSA PRIVATE KEY-----`;',
      'f();',
    ].join('\n');
    const { text } = redact(pem);
    expect(text.split('\n')).toHaveLength(5);
    expect(text).not.toContain('MIIEow');
    expect(text.split('\n')[4]).toBe('f();');
  });
});

test('entropy: случайное больше 4, повторяющееся — 0', () => {
  expect(entropy('aaaaaaaa')).toBe(0);
  expect(entropy('q8Zr2LmP0vX7nB4tK9sW1yE6uA3cJ5hD')).toBeGreaterThan(4);
});
