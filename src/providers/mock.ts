import type { Provider } from '../core/engine';
import type { Review } from '../core/reviewSchema';

/** Заготовленный ответ: интерфейс и тесты проверяются без сети и токенов. */
export const mockReview: Review = {
  summary: 'Mock: одно замечание для проверки интерфейса.',
  issues: [
    {
      patternId: 'mock',
      category: 'edge-case',
      severity: 'warning',
      confidence: 1,
      startLine: 2,
      endLine: 2,
      hint: 'Mock-намёк: что будет на этой строке с пустыми данными?',
      explanation: 'Mock-объяснение: здесь объясняется, почему это ошибка.',
      fix: { description: 'Mock-исправление', code: '// исправленный код' },
    },
  ],
};

export const mockProvider: Provider = {
  complete: async () => structuredClone(mockReview),
};
