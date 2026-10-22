import type { ModelRequest, Provider } from '../core/engine';
import type { Review } from '../core/reviewSchema';
import { checkJsonSchema } from '../core/selfCheck';

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
      example: '// Mock-пример: вызов, на котором видна ошибка',
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

/** Ответ «Проверь меня» с этой меткой mock считает верным. */
export const MOCK_RIGHT = 'mock: right';

export const mockProvider: Provider = {
  complete: async (request) => {
    lastMockRequest = request;
    if (request.jsonSchema === checkJsonSchema) {
      const understood = request.prompt.includes(MOCK_RIGHT);
      return {
        understood,
        feedback: understood
          ? 'Mock: верно.'
          : 'Mock: пока нет. Что здесь будет с пустыми данными?',
      };
    }
    return request.prompt.includes(MOCK_CLEAN)
      ? { summary: 'Mock: замечаний нет.', issues: [] }
      : structuredClone(mockReview);
  },
};
