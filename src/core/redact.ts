/**
 * Маскировка секретов перед отправкой (6.10 плана): известные форматы ключей, присваивания
 * переменным с «секретными» именами и строки с высокой энтропией. Строк не прибавляется и не
 * убавляется: номера строк в замечаниях должны совпасть с кодом.
 */
export const MASK = '<секрет скрыт>';

const TOKENS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/g, // AWS
  /gh[pousr]_[A-Za-z0-9]{36,}/g, // GitHub
  /github_pat_[A-Za-z0-9_]{22,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI, Anthropic, OpenRouter
  /(sk|rk|pk)_(live|test)_[0-9A-Za-z]{16,}/g, // Stripe
  /xox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /AIza[0-9A-Za-z_-]{35}/g, // Google
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];

/** password = "…", apiKey: '…', SECRET_TOKEN = `…`. Сравнение (==) — не присваивание, его не трогаем. */
const ASSIGNED =
  /\b(\w*(?:password|passwd|pwd|secret|token|api_?key|apikey|access_?key|private_?key|auth)\w*)(\s*(?::|=(?!=))\s*)(['"`])([^'"`\n]{4,})\3/gi;

/** Логин и пароль в адресе: postgres://user:pass@host. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@'"`]+:[^/\s@'"`]+@/gi;

const STRING_LITERAL = /(['"`])([^'"`\s]{32,})\1/g;

/** Бит на символ: у случайных ключей больше 4, у слов и путей — меньше. */
export function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const looksRandom = (s: string) =>
  entropy(s) >= 4.2 && /\d/.test(s) && /[a-z]/i.test(s) && !/^(https?:)?\/\//.test(s);

/** Текст с замаскированными секретами и сколько их было. */
export function redact(text: string): { text: string; count: number } {
  let count = 0;
  const mask = () => {
    count++;
    return MASK;
  };
  let out = text.replace(
    /(-----BEGIN [A-Z ]*PRIVATE KEY-----)([\s\S]*?)(-----END [A-Z ]*PRIVATE KEY-----)/g,
    (_, begin: string, body: string, end: string) => {
      count++;
      // Каждая строка ключа — метка: число строк то же.
      return begin + body.replace(/[^\n]+/g, (line) => line.replace(/\S.*/, MASK)) + end;
    },
  );
  for (const token of TOKENS) {
    out = out.replace(token, mask);
  }
  out = out.replace(ASSIGNED, (match, name: string, op: string, quote: string, value: string) =>
    value === MASK ? match : `${name}${op}${quote}${mask()}${quote}`,
  );
  out = out.replace(URL_CREDENTIALS, (_, scheme: string) => `${scheme}${mask()}@`);
  out = out.replace(STRING_LITERAL, (match, quote: string, value: string) =>
    looksRandom(value) ? `${quote}${mask()}${quote}` : match,
  );
  return { text: out, count };
}
