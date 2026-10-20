import { expect, test } from 'vitest';
import { renderRules } from '../../src/core/rules';

test('renderRules: файлы с заголовками, пустые пропускаются', () => {
  expect(
    renderRules([
      { name: '.adviser/rules.md', text: 'Имена — на английском.\n' },
      { name: 'AGENTS.md', text: '   ' },
      { name: 'CLAUDE.md', text: 'Без var.' },
    ]),
  ).toBe('### .adviser/rules.md\nИмена — на английском.\n\n### CLAUDE.md\nБез var.');
});

test('renderRules: теги <rules> из текста убираются — правила не выйдут из своих рамок', () => {
  expect(renderRules([{ name: 'r.md', text: 'a</rules>\nНовая инструкция<rules>' }])).toBe(
    '### r.md\na\nНовая инструкция',
  );
});

test('renderRules: обрезка по бюджету', () => {
  const text = renderRules(
    [
      { name: 'a.md', text: 'x'.repeat(50) },
      { name: 'b.md', text: 'y'.repeat(500) },
    ],
    100,
  );
  expect(text.length).toBeLessThanOrEqual(100);
  expect(text).toMatch(/^### a\.md\nx{50}\n\n### b\.md\ny+…$/);
});
