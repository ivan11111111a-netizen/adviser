import { describe, expect, test } from 'vitest';
import {
  diagnosticText,
  firstStep,
  holdSuggestions,
  hoverView,
  reveal,
  shortQuote,
} from '../../src/core/disclosure';
import type { Issue } from '../../src/core/reviewSchema';
import { mockReview } from '../../src/providers/mock';

const issue = (over: Partial<Issue> = {}): Issue => ({
  ...mockReview.issues[0],
  severity: 'warning',
  readMore: 'https://developer.mozilla.org/ru/',
  ...over,
});

describe('сначала ошибки, потом советы', () => {
  const s = (severity: Issue['severity'], patternId: string = severity) => ({
    severity,
    patternId,
  });

  test('есть critical или warning — советы придерживаются', () => {
    const issues = [s('critical'), s('suggestion', 'unclear-name'), s('warning')];
    expect(holdSuggestions(issues)).toEqual({
      shown: [s('critical'), s('warning')],
      held: [s('suggestion', 'unclear-name')],
    });
  });

  test('ошибок нет — советы показываются; пустой разбор — пустой', () => {
    const issues = [s('suggestion', 'a'), s('suggestion', 'b')];
    expect(holdSuggestions(issues)).toEqual({ shown: issues, held: [] });
    expect(holdSuggestions([])).toEqual({ shown: [], held: [] });
  });
});

describe('первая ступень', () => {
  test('warning и suggestion начинаются с намёка', () => {
    expect(firstStep(issue())).toBe(1);
    expect(firstStep(issue({ severity: 'suggestion' }))).toBe(1);
    expect(diagnosticText(issue())).toBe(issue().hint);
  });

  test('уязвимость пропускает намёк: в подчёркивании сразу объяснение', () => {
    expect(firstStep(issue({ category: 'security' }))).toBe(2);
    expect(diagnosticText(issue({ category: 'security' }))).toBe(issue().explanation);
  });

  test('critical — с намёком: неверный результат и есть учебный момент', () => {
    expect(firstStep(issue({ severity: 'critical' }))).toBe(1);
    expect(diagnosticText(issue({ severity: 'critical' }))).toBe(issue().hint);
  });
});

test('ревьюер: всё сразу — объяснение в подчёркивании, решение в hover, кнопок нет', () => {
  expect(firstStep(issue({ severity: 'suggestion' }), 'reviewer')).toBe(3);
  expect(diagnosticText(issue(), 'reviewer')).toBe(issue().explanation);
  expect(hoverView(issue(), 1, 'reviewer')).toEqual({
    explanation: undefined,
    readMore: 'https://developer.mozilla.org/ru/',
    example: issue().example,
    fix: issue().fix,
    actions: [],
  });
});

test('пустой намёк (убрал фильтр утечек) — как у уязвимости: сразу объяснение', () => {
  const noHint = issue({ hint: ' ' });
  expect(firstStep(noHint)).toBe(2);
  expect(diagnosticText(noHint)).toBe(noHint.explanation);
  expect(hoverView(noHint, 1).explanation).toBeUndefined();
});

test('пример — вместе с объяснением: не на ступени намёка, у уязвимости сразу', () => {
  const withExample = (over = {}) => issue({ example: 'first([]) // undefined', ...over });
  expect(hoverView(withExample(), 1).example).toBeUndefined();
  expect(hoverView(withExample(), 2).example).toBe('first([]) // undefined');
  expect(hoverView(withExample({ category: 'security' }), 1).example).toBe(
    'first([]) // undefined',
  );
  expect(hoverView(withExample({ example: '  ' }), 3).example).toBeUndefined();
});

test('решение скрыто правилами курса — кнопки «Показать решение» нет', () => {
  const hidden = issue({ fix: { description: '', code: '' } });
  expect(hoverView(hidden, 2)).toMatchObject({ fix: undefined, actions: [] });
  expect(hoverView(hidden, 1).actions).toEqual([2]);
});

test('ступени не закрываются обратно', () => {
  expect(reveal(1, 2)).toBe(2);
  expect(reveal(1, 3)).toBe(3);
  expect(reveal(3, 2)).toBe(3);
});

describe('hover', () => {
  test('на намёке — только кнопки «Объяснить» и «Показать решение»', () => {
    expect(hoverView(issue(), 1)).toEqual({
      explanation: undefined,
      readMore: undefined,
      fix: undefined,
      actions: [2, 3],
    });
  });

  test('объяснение открывается вместе со ссылкой, решение пока скрыто', () => {
    const view = hoverView(issue(), 2);
    expect(view.explanation).toBe(issue().explanation);
    expect(view.readMore).toBe('https://developer.mozilla.org/ru/');
    expect(view.fix).toBeUndefined();
    expect(view.actions).toEqual([3]);
  });

  test('решение показывает всё, кнопок больше нет', () => {
    const view = hoverView(issue(), 3);
    expect(view.explanation).toBe(issue().explanation);
    expect(view.fix).toEqual(issue().fix);
    expect(view.actions).toEqual([]);
  });

  test('уязвимость: объяснение уже в подчёркивании, в hover его не повторяем', () => {
    const view = hoverView(issue({ category: 'security' }), 1);
    expect(view.explanation).toBeUndefined();
    expect(view.readMore).toBe('https://developer.mozilla.org/ru/');
    expect(view.actions).toEqual([3]);
  });

  test('ссылка не по https не показывается', () => {
    expect(hoverView(issue({ readMore: 'http://example.com' }), 2).readMore).toBeUndefined();
    expect(hoverView(issue({ readMore: 'javascript:alert(1)' }), 2).readMore).toBeUndefined();
  });
});

describe('shortQuote', () => {
  test('короткий текст целиком, переносы схлопываются', () => {
    expect(shortQuote('Что вернёт\n  эта строка?')).toBe('Что вернёт эта строка?');
  });

  test('длинный режется по слову, без висящей пунктуации', () => {
    const text =
      'Что вернёт эта строка, если items окажется пустым массивом или вообще не массивом?';
    expect(shortQuote(text, 40)).toBe('Что вернёт эта строка, если items…');
  });
});
