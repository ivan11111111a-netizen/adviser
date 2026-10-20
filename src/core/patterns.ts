import { z } from 'zod';
import type { AdviceLanguage } from './promptBuilder';
import type { Review } from './reviewSchema';

/** Ставится, когда ни один тип из patterns/patterns.json не подошёл. */
export const OTHER_PATTERN = 'other';

/** Семейства языков в patterns.json → languageId VS Code. */
const FAMILIES = {
  js: ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'],
  ts: ['typescript', 'typescriptreact'],
  py: ['python'],
} as const;

const patternSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id в kebab-case')
    .refine((id) => id !== OTHER_PATTERN, 'other не пишется в список'),
  title: z.object({ ru: z.string().min(1), en: z.string().min(1) }),
  /** Нет поля — тип общий для всех языков. */
  languages: z.array(z.enum(Object.keys(FAMILIES) as [keyof typeof FAMILIES])).optional(),
});

const patternsFileSchema = z.object({
  patterns: z
    .array(patternSchema)
    .refine((list) => new Set(list.map((p) => p.id)).size === list.length, 'id повторяются'),
});

export type Pattern = z.infer<typeof patternSchema>;

/** Разбирает patterns/patterns.json. Бросает исключение, если файл не по схеме. */
export function parsePatterns(raw: unknown): Pattern[] {
  return patternsFileSchema.parse(raw).patterns;
}

/** Типы ошибок для языка файла: общие плюс свои. */
export function patternsFor(patterns: Pattern[], languageId: string): Pattern[] {
  return patterns.filter(
    (p) =>
      !p.languages ||
      p.languages.some((f) => (FAMILIES[f] as readonly string[]).includes(languageId)),
  );
}

/** Список для промпта: по строке на тип, названия на языке советов. */
export function renderPatterns(patterns: Pattern[], language: AdviceLanguage): string {
  return patterns.map((p) => `- ${p.id} — ${p.title[language]}`).join('\n');
}

/** Частые ошибки учащегося для промпта: тип, название и сколько раз за три недели. */
export function renderProfile(
  profile: { patternId: string; count: number }[],
  patterns: Pattern[],
  language: AdviceLanguage,
): string {
  return profile
    .map((p) => {
      const title = patterns.find((q) => q.id === p.patternId)?.title[language];
      return `- ${p.patternId}${title ? ` — ${title}` : ''} (×${p.count})`;
    })
    .join('\n');
}

/**
 * id не из списка заменяется на other: на этих id держится журнал повторов, и придуманные
 * моделью варианты (empty-array-division, empty-array-average) разбили бы один паттерн на несколько.
 */
export function normalizePatternIds(
  review: Review,
  patterns: Pattern[],
): { review: Review; unknown: string[] } {
  const known = new Set([...patterns.map((p) => p.id), OTHER_PATTERN]);
  const unknown: string[] = [];
  const issues = review.issues.map((issue) => {
    if (known.has(issue.patternId)) {
      return issue;
    }
    unknown.push(issue.patternId);
    return { ...issue, patternId: OTHER_PATTERN };
  });
  return { review: { ...review, issues }, unknown };
}
