/**
 * Код решения под отступ места, куда его вставляют: общий отступ фрагмента убираем,
 * ставим отступ первой заменяемой строки. Пустые строки остаются пустыми.
 */
export function reindent(code: string, indent: string): string {
  const lines = code.replace(/\s+$/, '').split(/\r?\n/);
  const common = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length),
  );
  return lines
    .map((l) => (l.trim() ? indent + l.slice(Number.isFinite(common) ? common : 0) : ''))
    .join('\n');
}
