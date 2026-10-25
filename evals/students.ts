// Настоящие решения студентов: ошибочные решения первокурсников Dublin City University
// (2017–2018, 10 задач на Python) с исправлениями преподавателей — набор intro_prog
// (huggingface.co/datasets/koutch/intro_prog, config dublin_repair; Azcona и др., 2019).
// Лицензия данных Дублина в карточке набора не указана, поэтому код в наш репозиторий не
// копируем: скачиваем на закреплённой ревизии в evals/runs/ (вне git), как и socratic.
// Место ошибки — строки решения, которые исправил преподаватель.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { EvalCase } from './cases';

const REVISION = '93e85b1025990ce55c9e81aca7b539a5d5bf4271';
const URL = `https://huggingface.co/datasets/koutch/intro_prog/resolve/${REVISION}/data/dublin_repair_test.jsonl`;

/** Сколько решений брать на задачу: в наборе 10 задач, решений на них — от 20 до 540. */
export const PER_ASSIGNMENT = 6;

const rowSchema = z.object({
  submission_id: z.number(),
  user: z.string(),
  assignment_id: z.string(),
  description: z.string(),
  test: z.string(),
  func_code: z.string(),
  /** Решение после исправления преподавателем. */
  annotation: z.string(),
});

export type StudentRow = z.infer<typeof rowSchema>;

export function parseRows(jsonl: string): StudentRow[] {
  return jsonl
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => rowSchema.parse(JSON.parse(l)));
}

/**
 * Строки решения (с 1), которые исправление изменило или рядом с которыми вставило код.
 * Сравнение по строкам без пустых, отступ значим (в Python он часть смысла), табуляция — 4 пробела.
 */
export function changedLines(buggy: string, fixed: string): number[] {
  const significant = (code: string) =>
    code
      .split(/\r?\n/)
      .map((text, i) => ({ text: text.replace(/\t/g, '    ').trimEnd(), line: i + 1 }))
      .filter((l) => l.text.trim());
  const a = significant(buggy);
  const b = significant(fixed);
  // Длина общей подпоследовательности суффиксов a[i..] и b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i].text === b[j].text ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const changed = new Set<number>();
  // Вставка между строками решения задевает обе соседние.
  const inserted = (i: number) => {
    if (i > 0) {
      changed.add(a[i - 1].line);
    }
    if (i < a.length) {
      changed.add(a[i].line);
    }
  };
  let i = 0;
  let j = 0;
  // Вставка сразу после удалённой строки — это замена: следующую строку она не задевает.
  let replacing = false;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].text === b[j].text) {
      i++;
      j++;
      replacing = false;
    } else if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
      changed.add(a[i++].line);
      replacing = true;
    } else {
      if (!replacing) {
        inserted(i);
      }
      j++;
    }
  }
  return [...changed].sort((x, y) => x - y);
}

/** Соседние изменённые строки (через одну тоже) — один фрагмент, то есть одна ошибка. */
export function hunks(lines: number[]): [number, number][] {
  const result: [number, number][] = [];
  for (const line of lines) {
    const last = result[result.length - 1];
    if (last && line - last[1] <= 2) {
      last[1] = line;
    } else {
      result.push([line, line]);
    }
  }
  return result;
}

/**
 * Решение, а не переписанная заново функция: не больше трёх фрагментов и исправлено не больше
 * 70% строк. Иначе «место ошибки» — почти вся функция, и попадание в него ничего не значит.
 */
export function isRepair(row: StudentRow): boolean {
  const lines = row.func_code.split(/\r?\n/).filter((l) => l.trim()).length;
  const changed = changedLines(row.func_code, row.annotation);
  return changed.length > 0 && hunks(changed).length <= 3 && changed.length <= 0.7 * lines;
}

/**
 * Файл для разбора: условие и проверки задачи комментарием над решением — без них не понять,
 * что функция должна делать (вернуть или напечатать, True или индекс). Строки сдвигаются на высоту комментария.
 */
export function toStudentCase(
  row: StudentRow,
  file: string,
  /** false — только условие, без проверок: насколько советам помогает точное условие задачи. */
  withTests = true,
): { text: string; evalCase: EvalCase } {
  const tests = row.test
    .trim()
    .replace(/^assert\s+/, '')
    .split(/\s+and\s+/)
    .map((t) => `#   ${t}`);
  const comment = [`# ${row.description.trim()}`, ...(withTests ? ['# Tests:', ...tests] : []), ''];
  const shift = comment.length;
  return {
    text: `${[...comment, row.func_code.trimEnd()].join('\n')}\n`,
    evalCase: {
      file,
      expect: hunks(changedLines(row.func_code, row.annotation)).map(([start, end]) => ({
        patterns: ['*'],
        lines: [start + shift, end + shift],
      })),
    },
  };
}

/**
 * По PER_ASSIGNMENT решений на задачу: равномерно по номерам решений и от разных студентов,
 * чтобы не взять пять попыток одного человека. Выбор детерминированный.
 */
export function pick(rows: StudentRow[]): StudentRow[] {
  const byAssignment = new Map<string, StudentRow[]>();
  for (const row of rows.filter(isRepair)) {
    byAssignment.set(row.assignment_id, [...(byAssignment.get(row.assignment_id) ?? []), row]);
  }
  return [...byAssignment.keys()].sort().flatMap((assignment) => {
    const all = byAssignment.get(assignment)!.sort((a, b) => a.submission_id - b.submission_id);
    const step = Math.max(1, Math.floor(all.length / PER_ASSIGNMENT));
    const picked: StudentRow[] = [];
    for (let start = 0; start < step && picked.length < PER_ASSIGNMENT; start++) {
      for (let k = start; k < all.length && picked.length < PER_ASSIGNMENT; k += step) {
        if (!picked.some((p) => p === all[k] || p.user === all[k].user)) {
          picked.push(all[k]);
        }
      }
    }
    return picked;
  });
}

/** Скачивает набор (один раз, в кэш) и готовит случаи eval. Без проверок — в своей папке. */
export async function loadStudents(root: string, withTests = true): Promise<EvalCase[]> {
  const external = path.join(root, 'evals', 'runs', 'external');
  const data = path.join(external, `dublin-${REVISION.slice(0, 7)}`);
  const dir = `dublin-${REVISION.slice(0, 7)}${withTests ? '' : '-no-tests'}`;
  const cache = path.join(external, dir);
  mkdirSync(cache, { recursive: true });
  mkdirSync(data, { recursive: true });
  const raw = path.join(data, 'dublin_repair_test.jsonl');
  if (!existsSync(raw)) {
    const response = await fetch(URL);
    if (!response.ok) {
      throw new Error(`не скачался набор intro_prog: ${response.status} ${URL}`);
    }
    writeFileSync(raw, await response.text());
  }
  return pick(parseRows(readFileSync(raw, 'utf8'))).map((row) => {
    const name = `${row.assignment_id}-${row.submission_id}.py`;
    const { text, evalCase } = toStudentCase(row, `../runs/external/${dir}/${name}`, withTests);
    writeFileSync(path.join(cache, name), text);
    return evalCase;
  });
}
