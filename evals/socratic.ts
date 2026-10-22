// Набор настоящих ошибок новичков: Socratic Debugging Benchmark (Al-Hossami et al., BEA 2023,
// SIGCSE 2024), github.com/taisazero/socratic-debugging-benchmark. У репозитория нет лицензии,
// поэтому его код в наш репозиторий не копируем: скачиваем на закреплённом коммите во время eval
// в evals/runs/ (вне git). Свою разметку не храним: ожидаемые строки — из описания ошибки.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EvalCase } from './cases';

const REPO = 'taisazero/socratic-debugging-benchmark';
const COMMIT = '3f77f8923b6b6e49d82fc65bebff2608da97b15e';
const DIR = 'socratic_debugging_benchmark/v2_sigcse/final_dataset';

export interface SocraticBug {
  id: string;
  problem: string;
  code: string;
  description: string;
  /** Описание исправления: в нём номер строки есть чаще, чем в описании ошибки. */
  fixes: string;
}

const section = (text: string, tag: string) =>
  new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(text)?.[1] ?? '';

/**
 * Отступы согласованы по правилам Python: глубже — только после строки с двоеточием,
 * мельче — только на уже открытый уровень.
 */
export function indentationValid(lines: string[]): boolean {
  const stack = [0];
  let opens = false;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }
    const indent = /^ */.exec(line)![0].length;
    const top = stack[stack.length - 1];
    if (indent > top) {
      if (!opens) {
        return false;
      }
      stack.push(indent);
    } else if (indent < top) {
      while (stack[stack.length - 1] > indent) {
        stack.pop();
      }
      if (stack[stack.length - 1] !== indent) {
        return false;
      }
    }
    opens = /:\s*(#.*)?$/.test(line);
  }
  return true;
}

/**
 * Код из <bug_code>. В наборе два формата: «10. b» — номер и один пробел, или номера выровнены
 * по колонке («9.     a» и «10.    b»). Берём тот, при котором отступы Python согласованы.
 */
export function stripLineNumbers(numbered: string): string {
  const lines = numbered.split(/\r?\n/).filter((l) => /^\d+\./.test(l));
  const spaced = lines.map((l) => l.replace(/^\d+\. ?/, ''));
  if (indentationValid(spaced)) {
    return spaced.join('\n');
  }
  const aligned = lines.map((l) => l.replace(/^\d+\./, (m) => ' '.repeat(m.length)).slice(3));
  return (indentationValid(aligned) ? aligned : spaced).join('\n');
}

/** Строки ошибки из описания: «On line 11», «lines 3 and 5», «lines 4-6». */
export function bugLines(description: string): number[] {
  const found = new Set<number>();
  for (const m of description.matchAll(/\blines?\s+(\d+)(?:\s*(?:-|–|to|and|,)\s*(\d+))?/gi)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) {
      found.add(n);
    }
  }
  return [...found].sort((x, y) => x - y);
}

export function parseBug(id: string, text: string): SocraticBug {
  return {
    id,
    problem: section(text, 'problem').trim(),
    code: stripLineNumbers(section(text, 'bug_code')),
    description: section(text, 'bug_desc').trim(),
    fixes: section(text, 'bug_fixes').trim(),
  };
}

/**
 * Файл для разбора: условие задачи комментарием над кодом — многие ошибки видны только
 * относительно условия. Ожидаемые строки сдвигаются на высоту комментария.
 */
export function toEvalCase(bug: SocraticBug, file: string): { text: string; evalCase?: EvalCase } {
  const comment = bug.problem
    .split(/\r?\n/)
    .map((l) => `# ${l}`.trimEnd())
    .concat('');
  const described = bugLines(bug.description);
  const lines = described.length ? described : bugLines(bug.fixes);
  const shift = comment.length;
  return {
    text: `${[...comment, bug.code].join('\n')}\n`,
    evalCase: lines.length
      ? {
          file,
          expect: [{ patterns: ['*'], lines: [lines[0] + shift, lines[lines.length - 1] + shift] }],
        }
      : undefined,
  };
}

/** Скачивает набор (один раз, в кэш) и готовит случаи eval. Без строк в описании — пропускаем. */
export async function loadSocratic(
  root: string,
): Promise<{ cases: EvalCase[]; skipped: string[] }> {
  const cache = path.join(root, 'evals', 'runs', 'external', `socratic-${COMMIT.slice(0, 7)}`);
  mkdirSync(cache, { recursive: true });
  const listFile = path.join(cache, 'list.json');
  if (!existsSync(listFile)) {
    const tree = (await (
      await fetch(`https://api.github.com/repos/${REPO}/git/trees/${COMMIT}?recursive=1`)
    ).json()) as { tree: { path: string }[] };
    const names = tree.tree
      .map((t) => t.path)
      .filter((p) => p.startsWith(`${DIR}/`) && p.endsWith('_socratic_dialogue.txt'))
      .map((p) => path.posix.basename(p));
    writeFileSync(listFile, JSON.stringify(names));
  }
  const names = JSON.parse(readFileSync(listFile, 'utf8')) as string[];
  const cases: EvalCase[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    const id = name.replace(/_socratic_dialogue\.txt$/, '');
    const raw = path.join(cache, name);
    if (!existsSync(raw)) {
      const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${DIR}/${name}`;
      writeFileSync(raw, await (await fetch(url)).text());
    }
    const file = `../runs/external/socratic-${COMMIT.slice(0, 7)}/${id}.py`;
    const bug = parseBug(id, readFileSync(raw, 'utf8'));
    const { text, evalCase } = toEvalCase(bug, file);
    writeFileSync(path.join(cache, `${id}.py`), text);
    // Синтаксис ловит компилятор: промпт велит его не повторять, а автопилот такие функции
    // не разбирает. Такие случаи не про Adviser.
    if (/syntax error/i.test(bug.description)) {
      skipped.push(id);
    } else if (evalCase) {
      cases.push(evalCase);
    } else {
      skipped.push(id);
    }
  }
  return { cases, skipped };
}
