/** .adviserignore в корне проекта (6.10 плана): файлы, которые Adviser не отправляет. */
export const IGNORE_FILE = '.adviserignore';

/**
 * Строки в синтаксисе .gitignore → glob-шаблоны от корня проекта, как в ignore из config.json.
 * Отрицания (!шаблон) не поддерживаются: отправить меньше безопаснее, чем больше.
 */
export function gitignoreToGlobs(text: string): { globs: string[]; skipped: string[] } {
  const globs: string[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('!')) {
      skipped.push(line);
      continue;
    }
    const dirOnly = line.endsWith('/');
    let pattern = line.replace(/\/+$/, '');
    // Без косой черты внутри шаблон работает на любой глубине, с ней — от корня.
    const anchored = pattern.includes('/');
    pattern = pattern.replace(/^\//, '');
    const base = anchored ? pattern : `**/${pattern}`;
    globs.push(`${base}/**`);
    if (!dirOnly) {
      globs.push(base);
    }
  }
  return { globs, skipped };
}
