import type { ModelRequest, Provider } from '../core/engine';
import type { Review } from '../core/reviewSchema';

/** Заготовленный ответ: интерфейс и тесты проверяются без сети и токенов. */
export const mockReview: Review = {
  summary: 'Mock: два замечания для проверки интерфейса.',
  issues: [
    {
      // Типы — настоящие из patterns.json: так через mock проверяются и повторы в журнале.
      patternId: 'empty-collection',
      category: 'edge-case',
      severity: 'warning',
      confidence: 1,
      startLine: 2,
      endLine: 2,
      hint: 'Mock-намёк: что будет на этой строке с пустыми данными?',
      explanation: 'Mock-объяснение: здесь объясняется, почему это ошибка.',
      fix: { description: 'Mock-исправление', code: '// исправленный код' },
    },
    {
      // На всю функцию: suggestion — это Hint, VS Code показывает его только у первых символов.
      patternId: 'unclear-name',
      category: 'readability',
      severity: 'suggestion',
      confidence: 1,
      startLine: 1,
      endLine: 3,
      hint: 'Mock-совет: можно ли назвать функцию понятнее?',
      explanation: 'Mock-объяснение совета.',
      fix: { description: 'Mock-переименование', code: '// новое имя' },
    },
  ],
};

/** Код с этой меткой mock считает исправленным: замечаний нет. */
export const MOCK_CLEAN = 'mock: clean';

/** Последний запрос к mock: тесты смотрят, что ушло бы модели. */
export let lastMockRequest: ModelRequest | undefined;

export const mockProvider: Provider = {
  complete: async (request) => {
    lastMockRequest = request;
    return request.prompt.includes(MOCK_CLEAN)
      ? { summary: 'Mock: замечаний нет.', issues: [] }
      : structuredClone(mockReview);
  },
};
