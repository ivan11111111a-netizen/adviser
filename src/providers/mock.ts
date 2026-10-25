import type { ModelRequest, Provider } from '../core/engine';
import type { Review } from '../core/reviewSchema';
import { exerciseJsonSchema } from '../core/exercise';
import { checkJsonSchema } from '../core/selfCheck';
import { answersJsonSchema, questionsJsonSchema } from '../core/understand';

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

/** С этой меткой ошибок нет, остался только совет: при ошибке советы придерживаются. */
export const MOCK_STYLE = 'mock: style';

/** Последний запрос к mock: тесты смотрят, что ушло бы модели. */
export let lastMockRequest: ModelRequest | undefined;

/** Ответ «Проверь меня» с этой меткой mock считает верным. */
export const MOCK_RIGHT = 'mock: right';

export const mockProvider: Provider = {
  complete: async (request) => {
    lastMockRequest = request;
    if (request.jsonSchema === questionsJsonSchema) {
      return {
        summary: 'Mock: изменение добавляет функцию.',
        questions: [
          { question: 'Mock: что вернёт функция?', file: 'mock.js', answer: 'Mock: число.' },
          { question: 'Mock: зачем проверка?', file: 'mock.js', answer: 'Mock: от пустого.' },
        ],
      };
    }
    if (request.jsonSchema === answersJsonSchema) {
      // Верен ответ с меткой MOCK_RIGHT.
      const answers = [...request.prompt.matchAll(/<answer>([\s\S]*?)<\/answer>/g)].map(
        (m) => m[1],
      );
      return {
        answers: answers.map((text, index) => ({
          index,
          understood: text.includes(MOCK_RIGHT),
          feedback: text.includes(MOCK_RIGHT) ? 'Mock: верно.' : 'Mock: на самом деле — число.',
        })),
      };
    }
    if (request.jsonSchema === exerciseJsonSchema) {
      return {
        task: 'Mock: функция возвращает первый товар из списка.',
        code: 'function firstItem(items) {\n  return items[0];\n}',
      };
    }
    if (request.jsonSchema === checkJsonSchema) {
      const understood = request.prompt.includes(MOCK_RIGHT);
      return {
        understood,
        feedback: understood
          ? 'Mock: верно.'
          : 'Mock: пока нет. Что здесь будет с пустыми данными?',
      };
    }
    if (request.prompt.includes(MOCK_CLEAN)) {
      return { summary: 'Mock: замечаний нет.', issues: [] };
    }
    if (request.prompt.includes(MOCK_STYLE)) {
      return { summary: 'Mock: только совет.', issues: [structuredClone(mockReview.issues[1])] };
    }
    return structuredClone(mockReview);
  },
};
