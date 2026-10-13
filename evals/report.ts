import { scoreCase, summarize, type CaseResult, type Summary } from './score';

export interface RunMeta {
  id: string;
  date: string;
  provider: string;
  model: string;
  prompt: string;
  language: string;
  /** Модель и промпт судьи, если намёки оценивали. */
  judge?: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function metricsRows(s: Summary): string[] {
  const judged = (x: number) => (s.judgedHints ? `${pct(x)} из ${s.judgedHints}` : '—');
  return [
    `| по делу (precision) | ${pct(s.precision)} | от 70% |`,
    `| нашлось из ожидаемого (recall) | ${pct(s.recall)} | — |`,
    `| тишина на чистом коде | ${s.silent} из ${s.clean} | большинство |`,
    `| намёк не выдаёт ответ (судья) | ${judged(1 - s.hintLeaks)} | почти все |`,
    `| намёк наводит на проблему (судья) | ${judged(s.hintGuides)} | — |`,
    `| намёк задаёт вопрос | ${pct(s.questionHints)} | — |`,
    `| замечаний всего | ${s.issues} | — |`,
    `| не ответила | ${s.failed} из ${s.cases} | 0 |`,
    `| время, медиана | ${s.medianSeconds.toFixed(1)} с | до 10 с |`,
  ];
}

/** Отчёт прогона для автора: метрики, пропуски и шум — по шуму видно, где поправить ожидания или промпт. */
export function renderReport(meta: RunMeta, results: CaseResult[]): string {
  const out = [
    `# Eval ${meta.id}`,
    '',
    `${meta.date} · ${meta.provider} / ${meta.model} · промпт ${meta.prompt} · советы: ${meta.language}` +
      (meta.judge ? ` · судья ${meta.judge}` : ''),
    '',
    '| метрика | значение | цель этапа 3 |',
    '|---|---|---|',
    ...metricsRows(summarize(results)),
    '',
    '| язык | случаев | по делу | нашлось | тишина |',
    '|---|---|---|---|---|',
  ];
  const groups = [...new Set(results.map((r) => r.evalCase.file.split('/')[0]))];
  for (const group of groups) {
    const s = summarize(results.filter((r) => r.evalCase.file.startsWith(`${group}/`)));
    out.push(
      `| ${group} | ${s.cases} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.silent} из ${s.clean} |`,
    );
  }

  const missed: string[] = [];
  const noise: string[] = [];
  const leaks: string[] = [];
  const riddles: string[] = [];
  const failed: string[] = [];
  const details: string[] = [];
  for (const r of results) {
    if (!r.issues) {
      failed.push(`- ${r.evalCase.file}`);
      continue;
    }
    const score = scoreCase(r.evalCase, r.issues);
    for (const e of score.missed) {
      const { patterns, lines } = r.evalCase.expect[e];
      missed.push(`- ${r.evalCase.file}: ${patterns.join(' / ')}, строки ${lines[0]}–${lines[1]}`);
    }
    details.push(`### ${r.evalCase.file}`, '');
    if (!r.issues.length) {
      details.push('Замечаний нет.', '');
    }
    r.issues.forEach((issue, i) => {
      const where = `${issue.patternId}, ${issue.severity} ${issue.confidence}, строки ${issue.startLine}–${issue.endLine}`;
      const hint = `${r.evalCase.file}: «${oneLine(issue.hint)}»`;
      if (score.verdicts[i] === 'noise') {
        noise.push(`- ${r.evalCase.file}: ${where} — «${oneLine(issue.hint)}»`);
      }
      details.push(`- **${score.verdicts[i]}** ${where}`, `  - намёк: ${oneLine(issue.hint)}`);
      const judgment = r.judgments?.find((j) => j.index === i);
      if (judgment) {
        const verdict = `${judgment.leaks ? 'выдаёт ответ' : 'не выдаёт'}, ${judgment.guides ? 'наводит' : 'не наводит'}`;
        details.push(`  - судья: ${verdict} — ${oneLine(judgment.comment)}`);
        if (judgment.leaks) {
          leaks.push(`- ${hint} — ${oneLine(judgment.comment)}`);
        }
        if (!judgment.guides) {
          riddles.push(`- ${hint} — ${oneLine(judgment.comment)}`);
        }
      }
      details.push(`  - объяснение: ${oneLine(issue.explanation)}`);
      details.push(`  - решение: ${oneLine(issue.fix.description)}`);
    });
    details.push('');
  }

  const section = (title: string, lines: string[]) =>
    out.push('', `## ${title}`, '', ...(lines.length ? lines : ['Нет.']));
  section('Пропущено', missed);
  section('Шум', noise);
  if (meta.judge) {
    section('Намёк выдаёт ответ', leaks);
    section('Намёк не наводит на проблему', riddles);
  }
  if (failed.length) {
    section('Не ответила', failed);
  }
  out.push('', '## Все ответы', '', ...details);
  return out.join('\n');
}
