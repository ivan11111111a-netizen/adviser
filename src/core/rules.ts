/** Правила стиля проекта (6.3 плана): .adviser/rules.md и, если включено, файлы для ИИ-агентов. */
export const RULES_FILE = '.adviser/rules.md';
export const AGENT_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
];

/** Правила идут в каждый запрос, поэтому их место ограничено. */
export const RULES_BUDGET = 2000;

/**
 * Правила для промпта: по файлу с заголовком, пока влезает в бюджет. Текст — данные из репозитория:
 * закрывающий тег из него убираем, чтобы он не вышел за свои рамки в промпте.
 */
export function renderRules(files: { name: string; text: string }[], budget = RULES_BUDGET) {
  let out = '';
  for (const { name, text } of files) {
    const body = text.replace(/<\/?rules>/gi, '').trim();
    if (!body) {
      continue;
    }
    const block = `### ${name}\n${body}`;
    const room = budget - out.length - (out ? 2 : 0);
    if (room <= name.length + 10) {
      break;
    }
    out += (out ? '\n\n' : '') + (block.length > room ? `${block.slice(0, room - 1)}…` : block);
  }
  return out;
}
