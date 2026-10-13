import { z } from 'zod';

export const CATEGORIES = [
  'bug',
  'edge-case',
  'security',
  'performance',
  'readability',
  'style',
  'project-fit',
] as const;

export const SEVERITIES = ['critical', 'warning', 'suggestion'] as const;

// Номера строк считаются от первой строки функции (1), в строки файла их переводит расширение.
export const issueSchema = z.object({
  patternId: z.string(),
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  confidence: z.number().min(0).max(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  hint: z.string(),
  explanation: z.string(),
  fix: z.object({ description: z.string(), code: z.string() }),
  readMore: z.string().optional(),
});

export const reviewSchema = z.object({
  summary: z.string(),
  issues: z.array(issueSchema),
});

export type Issue = z.infer<typeof issueSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Severity = (typeof SEVERITIES)[number];

/** Та же схема в JSON Schema — для провайдеров со structured outputs. */
export const reviewJsonSchema = z.toJSONSchema(reviewSchema) as Record<string, unknown>;
