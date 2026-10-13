import { expect, test } from 'vitest';
import { reviewJsonSchema, reviewSchema } from '../../src/core/reviewSchema';
import { mockReview } from '../../src/providers/mock';

test('пример из плана (6.4) проходит схему', () => {
  expect(reviewSchema.safeParse(mockReview).success).toBe(true);
});

test('неизвестная категория и строки с нуля не проходят', () => {
  const bad = (over: object) => ({
    ...mockReview,
    issues: [{ ...mockReview.issues[0], ...over }],
  });
  expect(reviewSchema.safeParse(bad({ category: 'typo' })).success).toBe(false);
  expect(reviewSchema.safeParse(bad({ startLine: 0 })).success).toBe(false);
});

test('JSON Schema для провайдеров требует те же поля', () => {
  type Node = {
    required: string[];
    properties: Record<string, Node & { enum?: string[] }>;
    items: Node;
  };
  const issue = (reviewJsonSchema as unknown as Node).properties.issues.items;
  expect(reviewJsonSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
  expect(reviewJsonSchema.required).toEqual(['summary', 'issues']);
  expect(issue.required).toContain('hint');
  expect(issue.required).not.toContain('readMore');
  expect(issue.properties.severity.enum).toEqual(['critical', 'warning', 'suggestion']);
});
