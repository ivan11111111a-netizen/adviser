// Eval советов (этап 3): прогоняет набор evals/cases.json через тот же промпт и движок, что
// и расширение, и считает метрики. Справка: npm run eval -- --help
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MIN_CONFIDENCE, runReview, runStructured, type Provider } from '../src/core/engine';
import { hintLeak } from '../src/core/hintGuard';
import { normalizePatternIds, parsePatterns, patternsFor } from '../src/core/patterns';
import {
  ADVICE_LANGUAGES,
  buildPrompt,
  parseTemplate,
  PROMPT_VERSION,
} from '../src/core/promptBuilder';
import type { Issue } from '../src/core/reviewSchema';
import { buildCheckPrompt, CHECK_PROMPT_VERSION, checkSchema } from '../src/core/selfCheck';
import { createClaudeCodeProvider, resolveClaudeExecutable } from '../src/providers/claudeCode';
import { mockProvider } from '../src/providers/mock';
import { createOpenAICompatibleProvider } from '../src/providers/openaiCompatible';
import { languageIdOf, parseCases, type EvalCase } from './cases';
import { parseCheckCases, renderCheckReport, summarizeChecks, type CheckRecord } from './check';
import {
  buildJudgeRequest,
  judgedIndexes,
  judgeHints,
  JUDGE_PROMPT_VERSION,
  type Judgment,
} from './judge';
import { renderReport, type RunMeta } from './report';
import { loadSocratic } from './socratic';
import { summarize, withMinConfidence, type CaseResult } from './score';

const HELP = `npm run eval -- [параметры]

  --provider claude-code|openai-compatible|mock   по умолчанию claude-code (только для разработки)
  --model <id>          кто разбирает код, по умолчанию sonnet
  --judge <id>          модель-судья намёков у того же провайдера; без параметра судьи нет
  --base-url <url>      для openai-compatible, по умолчанию OpenRouter; ключ — в ADVISER_API_KEY
  --language ru|en      язык советов, по умолчанию ru
  --suite cases|socratic|check
                        наш набор evals/cases.json, настоящие ошибки новичков из Socratic Debugging
                        Benchmark (скачивается в evals/runs/, засчитывается место ошибки) или
                        «Проверь меня» на evals/check-cases.json (понял ли учащийся ошибку)
  --prompt <версия>     промпт из prompts/, по умолчанию тот, что в расширении (${PROMPT_VERSION};
                        для --suite check — ${CHECK_PROMPT_VERSION})
  --profile <id,id,…>   профиль учащегося: эти типы ошибок как частые (по 3 раза), если в промпте
                        есть {{profile}}. Проверка, не начнёт ли модель их выдумывать
  --only <подстрока>    только случаи, в пути которых она есть: --only py/
  --concurrency <n>     сколько запросов сразу, по умолчанию 3
  --rescore <файл.json> взять ответы сохранённого прогона, а не спрашивать модель: пересчитать
                        метрики по текущему evals/cases.json или добавить оценки судьи (--judge)
  --min-confidence <x>  для подбора порога: в отчёт идут только замечания с confidence от x
                        (сохранённые ответы уже отсечены порогом движка ${MIN_CONFIDENCE})

Результат: evals/runs/<id>.json (ответы и оценки) и evals/runs/<id>.md (отчёт).`;

interface RunRecord extends RunMeta {
  results: {
    file: string;
    seconds: number;
    issues?: Issue[];
    error?: string;
    judgments?: Judgment[];
  }[];
}

const ROOT = process.cwd();
const RUNS = path.join(ROOT, 'evals', 'runs');
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), 'utf8');

const { values: args } = parseArgs({
  options: {
    provider: { type: 'string', default: 'claude-code' },
    model: { type: 'string', default: 'sonnet' },
    judge: { type: 'string' },
    'base-url': { type: 'string', default: 'https://openrouter.ai/api/v1' },
    language: { type: 'string', default: 'ru' },
    prompt: { type: 'string', default: PROMPT_VERSION },
    suite: { type: 'string', default: 'cases' },
    profile: { type: 'string' },
    only: { type: 'string' },
    concurrency: { type: 'string', default: '3' },
    rescore: { type: 'string' },
    'min-confidence': { type: 'string' },
    help: { type: 'boolean' },
  },
});

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const concurrency = Number(args.concurrency) || 3;
if (args.suite === 'check') {
  await checks();
  process.exit(0);
}
const suite =
  args.suite === 'socratic'
    ? (await loadSocratic(ROOT)).cases
    : parseCases(JSON.parse(read('evals', 'cases.json')));
const cases = suite.filter((c) => !args.only || c.file.includes(args.only));

const record = args.rescore
  ? (JSON.parse(readFileSync(args.rescore, 'utf8')) as RunRecord)
  : await review();
if (args.judge) {
  await judge(record, args.judge);
}
save(record);

async function review(): Promise<RunRecord> {
  const language = ADVICE_LANGUAGES.find((l) => l === args.language);
  if (!language) {
    throw new Error(`--language: ${ADVICE_LANGUAGES.join(' или ')}`);
  }
  const provider = createProvider(args.provider!, args.model!);
  const template = parseTemplate(read('prompts', `${args.prompt}.md`));
  const profile = args.profile?.split(',').map((patternId) => ({ patternId, count: 3 }));
  const patterns = parsePatterns(JSON.parse(read('patterns', 'patterns.json')));
  const now = new Date();
  const record: RunRecord = {
    id: `${stamp(now)}-${args.suite === 'socratic' ? 'socratic-' : ''}${args.provider}-${args.model}-${args.prompt}${profile ? '-profile' : ''}`.replace(
      /[^\w.-]+/g,
      '_',
    ),
    date: now.toLocaleString('ru-RU'),
    provider: args.provider!,
    model: args.model!,
    prompt: profile ? `${args.prompt}, профиль: ${args.profile}` : args.prompt!,
    language,
    results: [],
  };
  console.log(`${record.id}: ${cases.length} случаев`);

  await pool(cases, concurrency, async (evalCase: EvalCase) => {
    const languageId = languageIdOf(evalCase.file)!;
    const request = buildPrompt(template, {
      languageId,
      code: read('evals', 'cases', evalCase.file),
      level: evalCase.level ?? 'beginner',
      language,
      patterns: patternsFor(patterns, languageId),
      profile,
    });
    const started = Date.now();
    const result = await runReview(provider, request);
    const seconds = (Date.now() - started) / 1000;
    const code = read('evals', 'cases', evalCase.file);
    // Как в расширении: намёк, который называет новое из решения, убирается (src/core/hintGuard.ts).
    const issues = result.ok
      ? normalizePatternIds(result.review, patterns).review.issues.map((issue) =>
          hintLeak(issue.hint, issue.fix.code, code) ? { ...issue, hint: '' } : issue,
        )
      : undefined;
    record.results.push({
      file: evalCase.file,
      seconds,
      issues,
      error: result.ok ? undefined : result.error,
    });
    const what = result.ok
      ? issues!.map((i) => i.patternId).join(', ') || 'замечаний нет'
      : result.error;
    console.log(`${result.ok ? '+' : '!'} ${evalCase.file} ${seconds.toFixed(1)} с: ${what}`);
  });
  record.results.sort((a, b) => a.file.localeCompare(b.file));
  return record;
}

/** Оценки судьи дописываются в прогон; уже оценённые этой же моделью случаи не переоцениваются. */
async function judge(record: RunRecord, model: string) {
  const judgeName = `${model}, ${JUDGE_PROMPT_VERSION}`;
  if (record.judge !== judgeName) {
    record.results.forEach((r) => delete r.judgments);
    record.judge = judgeName;
  }
  const provider = createProvider(args.provider!, model);
  const system = read('evals', `${JUDGE_PROMPT_VERSION}.md`);
  const wanted = new Set(cases.map((c) => c.file));
  const todo = record.results.filter(
    (r) => wanted.has(r.file) && r.issues && !r.judgments && judgedIndexes(r.issues).length,
  );
  console.log(`судья ${judgeName}: ${todo.length} случаев`);
  await pool(todo, concurrency, async (r) => {
    const request = buildJudgeRequest(
      system,
      languageIdOf(r.file)!,
      read('evals', 'cases', r.file),
      r.issues!,
    );
    const result = await judgeHints(provider, request, r.issues!);
    if (result.ok) {
      r.judgments = result.judgments;
    }
    const what = result.ok
      ? result.judgments
          .map((j) => `${j.leaks ? 'выдаёт' : 'ок'}/${j.guides ? 'наводит' : 'мимо'}`)
          .join(', ')
      : result.error;
    console.log(`${result.ok ? '+' : '!'} судья ${r.file}: ${what}`);
  });
}

function save(record: RunRecord) {
  mkdirSync(RUNS, { recursive: true });
  writeFileSync(path.join(RUNS, `${record.id}.json`), JSON.stringify(record, null, 2));
  const byFile = new Map(record.results.map((r) => [r.file, r]));
  const min = args['min-confidence'] ? Number(args['min-confidence']) : undefined;
  const results = cases.flatMap((evalCase): CaseResult[] => {
    const r = byFile.get(evalCase.file);
    if (!r) {
      return [];
    }
    const result = { evalCase, issues: r.issues, seconds: r.seconds, judgments: r.judgments };
    return [min === undefined ? result : withMinConfidence(result, min)];
  });
  // Отчёт с другим порогом не затирает основной.
  const reportFile = path.join(RUNS, `${record.id}${min === undefined ? '' : `.min${min}`}.md`);
  writeFileSync(reportFile, renderReport(record, results));
  const s = summarize(results);
  const judged = s.judgedHints
    ? ` · намёк не выдаёт ответ ${Math.round((1 - s.hintLeaks) * 100)}%, наводит ${Math.round(s.hintGuides * 100)}%`
    : '';
  console.log(
    `\nпо делу ${Math.round(s.precision * 100)}% · нашлось ${Math.round(s.recall * 100)}% · ` +
      `тишина ${s.silent} из ${s.clean}${judged} · не ответила ${s.failed} · медиана ${s.medianSeconds.toFixed(1)} с`,
  );
  console.log(`отчёт: ${path.relative(ROOT, reportFile)}`);
}

/** --suite check: «Проверь меня» на evals/check-cases.json (evals/check.ts). */
async function checks() {
  const language = ADVICE_LANGUAGES.find((l) => l === args.language);
  if (!language) {
    throw new Error(`--language: ${ADVICE_LANGUAGES.join(' или ')}`);
  }
  const provider = createProvider(args.provider!, args.model!);
  // --prompt по умолчанию — промпт разбора; у проверки свой.
  const version = args.prompt === PROMPT_VERSION ? CHECK_PROMPT_VERSION : args.prompt!;
  const template = parseTemplate(read('prompts', `${version}.md`));
  const items = parseCheckCases(JSON.parse(read('evals', 'check-cases.json')))
    .filter((c) => !args.only || c.file.includes(args.only))
    .flatMap((evalCase) => evalCase.answers.map((answer) => ({ evalCase, answer })));
  const id = `${stamp(new Date())}-check-${args.provider}-${args.model}-${version}`.replace(
    /[^\w.-]+/g,
    '_',
  );
  console.log(`${id}: ${items.length} ответов`);
  const records: CheckRecord[] = [];
  await pool(items, concurrency, async ({ evalCase, answer }) => {
    const code = read('evals', 'cases', evalCase.file);
    const request = buildCheckPrompt(template, {
      languageId: languageIdOf(evalCase.file)!,
      code,
      level: evalCase.level ?? 'beginner',
      language,
      issue: evalCase.issue,
      answer: answer.text,
    });
    const started = Date.now();
    const result = await runStructured(checkSchema, provider, request);
    const record: CheckRecord = {
      file: evalCase.file,
      answer: answer.text,
      expected: answer.understood,
      seconds: (Date.now() - started) / 1000,
    };
    if (result.ok) {
      record.got = result.data.understood;
      record.feedback = result.data.feedback;
      record.leak =
        (!result.data.understood && hintLeak(result.data.feedback, evalCase.issue.fix, code)) ||
        undefined;
    } else {
      record.error = result.error;
    }
    records.push(record);
    const verdict = result.ok
      ? `${record.got === record.expected ? 'ок' : 'НЕВЕРНО'}: ${record.feedback}`
      : result.error;
    console.log(`${result.ok ? '+' : '!'} ${evalCase.file} «${answer.text}» — ${verdict}`);
  });
  records.sort((a, b) => a.file.localeCompare(b.file) || a.answer.localeCompare(b.answer));
  mkdirSync(RUNS, { recursive: true });
  writeFileSync(path.join(RUNS, `${id}.json`), JSON.stringify(records, null, 2));
  const reportFile = path.join(RUNS, `${id}.md`);
  const meta = {
    id,
    date: new Date().toLocaleString('ru-RU'),
    model: args.model!,
    prompt: version,
  };
  writeFileSync(reportFile, renderCheckReport(meta, records));
  const s = summarizeChecks(records);
  console.log(
    `\nоценка верна ${s.correct} из ${s.total - s.failed} · «верно» на неверный ${s.falseAccepts} · ` +
      `«не то» на верный ${s.falseRejects} · выдаёт решение ${s.leaks} из ${s.rejected} · ` +
      `не ответила ${s.failed} · медиана ${s.medianSeconds.toFixed(1)} с`,
  );
  console.log(`отчёт: ${path.relative(ROOT, reportFile)}`);
}

/** Местное время для имени файла: 20261013-2326. */
function stamp(now: Date): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
    .replace(/[-:]/g, '')
    .replace('T', '-');
}

function createProvider(kind: string, model: string): Provider {
  switch (kind) {
    case 'claude-code':
      return createClaudeCodeProvider({ executable: resolveClaudeExecutable('claude'), model });
    case 'openai-compatible':
      return createOpenAICompatibleProvider({
        baseURL: args['base-url']!,
        apiKey: process.env.ADVISER_API_KEY,
        model,
      });
    case 'mock':
      return mockProvider;
    default:
      throw new Error(`неизвестный провайдер ${kind}\n\n${HELP}`);
  }
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        await work(item);
      }
    }),
  );
}
