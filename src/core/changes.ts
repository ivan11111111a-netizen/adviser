import type { FunctionRange, LineRange } from './codeRange';

/** Функция документа вместе с её текстом. */
export interface FunctionCode extends FunctionRange {
  code: string;
}

/** Изменённая функция: reviewedAt — когда её разбирали в последний раз, для cooldown. */
export interface ChangedFunction extends FunctionCode {
  reviewedAt?: number;
}

/** Правка из onDidChangeTextDocument: строки start..end текста до правки заменены newLines строками. */
export interface LineEdit {
  start: number;
  end: number;
  newLines: number;
}

/**
 * Код без того, что не меняет смысла: пустых строк, строк-комментариев и лишних пробелов.
 * Правки только в них автопилот не разбирает. В Python отступ — часть смысла, его оставляем.
 */
export function fingerprint(code: string, languageId: string): string {
  const python = languageId === 'python';
  const comment = python ? /^#/ : /^(\/\/|\/\*|\*(\s|\/|$))/;
  return code
    .split(/\r?\n/)
    .flatMap((line) => {
      const text = line.trim().replace(/\s+/g, ' ');
      if (!text || comment.test(text)) {
        return [];
      }
      return [python ? /^\s*/.exec(line)![0] + text : text];
    })
    .join('\n');
}

/**
 * Где теперь диапазон после правок. undefined — правка задела сам диапазон.
 * Правки одного события даны по тексту до события, поэтому применяем их снизу вверх.
 */
export function shiftRange(range: LineRange, edits: LineEdit[]): LineRange | undefined {
  let { start, end } = range;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (edit.start > end) {
      continue;
    }
    if (edit.end >= start) {
      return undefined;
    }
    const delta = edit.newLines - (edit.end - edit.start + 1);
    start += delta;
    end += delta;
  }
  return { start, end };
}

/**
 * Строки замечания после правок: правки выше сдвигают их, правки внутри растягивают или сжимают.
 * Замечание остаётся на своём коде, пока функцию не разберут заново.
 */
export function trackRange(range: LineRange, edits: LineEdit[]): LineRange {
  let { start, end } = range;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    const delta = edit.newLines - (edit.end - edit.start + 1);
    if (edit.end < start) {
      start += delta;
      end += delta;
    } else if (edit.start <= end) {
      // Правка задела замечание: его конец едет вместе с концом правки,
      // а если правка началась выше — замечание начинается с неё.
      end = edit.end <= end ? end + delta : edit.start + edit.newLines - 1;
      start = Math.min(start, edit.start);
    }
  }
  return { start, end: Math.max(start, end) };
}

interface Known {
  fingerprint: string;
  reviewedAt?: number;
}

/**
 * Трекер изменений одного документа (6.1 плана). Копит тронутые строки и по ним находит
 * изменённые функции. Функции, которых не касались, не разбираются, даже если их ещё ни разу
 * не разбирали: автопилот смотрит только на то, что человек пишет сейчас.
 */
export class DocumentChanges {
  private touched = new Set<number>();
  /** Отпечаток функции, когда её разбирали или впервые увидели нетронутой. */
  private readonly known = new Map<string, Known>();
  /** Разобранный код без имени функции: так помечает разбор командой. */
  private readonly reviewedCode = new Map<string, number>();

  constructor(private readonly languageId: string) {}

  edit(edits: LineEdit[]) {
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
      const delta = edit.newLines - (edit.end - edit.start + 1);
      const next = new Set<number>();
      for (const line of this.touched) {
        if (line < edit.start) {
          next.add(line);
        } else if (line > edit.end) {
          next.add(line + delta);
        }
      }
      for (let line = edit.start; line < edit.start + edit.newLines; line++) {
        next.add(line);
      }
      this.touched = next;
    }
  }

  get hasTouched() {
    return this.touched.size > 0;
  }

  /**
   * Изменённые функции: в них есть тронутые строки, а смысл отличается от разобранного.
   * Нетронутые функции запоминаются как есть, а тронутые без изменений смысла — забываются.
   */
  changed(functions: FunctionCode[]): ChangedFunction[] {
    const changed: ChangedFunction[] = [];
    for (const fn of functions) {
      const print = fingerprint(fn.code, this.languageId);
      const known = this.known.get(fn.key);
      if (!this.touches(fn)) {
        if (!known) {
          this.known.set(fn.key, { fingerprint: print });
        }
        continue;
      }
      const reviewedAt = this.reviewedCode.get(print);
      if (reviewedAt !== undefined) {
        this.reviewedCode.delete(print);
        this.known.set(fn.key, { fingerprint: print, reviewedAt });
      }
      if (this.known.get(fn.key)?.fingerprint === print) {
        this.untouch(fn);
      } else {
        changed.push({ ...fn, reviewedAt: known?.reviewedAt });
      }
    }
    return changed;
  }

  /** Код разобран. key есть, когда разбирал автопилот; у разбора командой функция неизвестна. */
  reviewed(code: string, at: number, key?: string) {
    const print = fingerprint(code, this.languageId);
    if (key) {
      this.known.set(key, { fingerprint: print, reviewedAt: at });
    } else {
      this.reviewedCode.set(print, at);
    }
  }

  private touches(range: LineRange) {
    for (let line = range.start; line <= range.end; line++) {
      if (this.touched.has(line)) {
        return true;
      }
    }
    return false;
  }

  private untouch(range: LineRange) {
    for (let line = range.start; line <= range.end; line++) {
      this.touched.delete(line);
    }
  }
}
