import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  DEFAULT_TRIGGERS,
  filterIssues,
  mergeSettings,
  parseProjectConfig,
  projectConfigSchema,
} from '../../src/core/projectConfig';
import type { Issue } from '../../src/core/reviewSchema';
import { MENTOR_LIMITS } from '../../src/core/scheduler';
import { mockReview } from '../../src/providers/mock';

const user = { mode: 'mentor' as const, level: 'beginner' as const, language: 'auto' };

describe('parseProjectConfig', () => {
  test('пример из плана разбирается, лишние поля не мешают', () => {
    const { config, error } = parseProjectConfig(
      JSON.stringify({
        mode: 'mentor',
        level: 'beginner',
        triggers: { onSave: true, onLeaveFunction: true, idleSeconds: 30 },
        limits: { perHour: 20, perDay: 60, cooldownMinutes: 5, maxIssuesPerBlock: 3 },
        minSeverity: 'suggestion',
        categories: { style: true, performance: false },
        language: 'ru',
        readAgentFiles: true,
        ignore: ['dist/**'],
      }),
    );
    expect(error).toBeUndefined();
    expect(config?.limits?.perDay).toBe(60);
  });

  test('ошибки — понятной строкой: не JSON и не по схеме', () => {
    expect(parseProjectConfig('{ mode: ').error).toMatch(/^не JSON/);
    expect(parseProjectConfig('{"mode":"loud","limits":{"perHour":-1}}').error).toMatch(
      /mode: .*; limits\.perHour: /,
    );
  });

  test('провайдера, адреса и модели в схеме нет', () => {
    expect(Object.keys(projectConfigSchema.shape)).not.toEqual(
      expect.arrayContaining(['provider', 'baseUrl', 'model']),
    );
  });
});

describe('mergeSettings', () => {
  test('без проекта — настройки пользователя и умолчания', () => {
    expect(mergeSettings(user)).toEqual({
      ...user,
      triggers: DEFAULT_TRIGGERS,
      limits: MENTOR_LIMITS,
      maxIssues: 3,
      minSeverity: 'suggestion',
      hiddenCategories: [],
      ignore: [],
      fromProject: [],
    });
  });

  test('проект перекрывает уровень, язык, триггеры, фильтры', () => {
    const s = mergeSettings(user, {
      level: 'advanced',
      language: 'en',
      triggers: { onSave: false, idleSeconds: 0 },
      minSeverity: 'warning',
      categories: { style: false, security: true },
      ignore: ['gen/**'],
    });
    expect(s.level).toBe('advanced');
    expect(s.language).toBe('en');
    expect(s.triggers).toEqual({ onSave: false, onLeaveFunction: true, pauseMs: 0 });
    expect(s.hiddenCategories).toEqual(['style']);
    expect(s.fromProject).toEqual([
      'level',
      'language',
      'triggers',
      'minSeverity',
      'categories',
      'ignore',
    ]);
  });

  test('лимиты проект может только ужесточить', () => {
    const generous = mergeSettings(user, {
      limits: { perHour: 1000, perDay: 10_000, cooldownMinutes: 0 },
    });
    expect(generous.limits).toEqual(MENTOR_LIMITS);
    const strict = mergeSettings(user, {
      limits: { perHour: 5, perDay: 30, cooldownMinutes: 5, maxIssuesPerBlock: 1 },
    });
    expect(strict.limits).toMatchObject({ perHour: 5, perDay: 30, cooldownMs: 300_000 });
    expect(strict.maxIssues).toBe(1);
  });

  test('проект может выключить автопилот, но не включить его тому, кто выбрал «Вручную»', () => {
    expect(mergeSettings(user, { mode: 'manual' }).mode).toBe('manual');
    expect(mergeSettings({ ...user, mode: 'manual' }, { mode: 'mentor' }).mode).toBe('manual');
  });
});

test('filterIssues: серьёзность, категории, число', () => {
  const issue = (over: Partial<Issue>) => ({ ...mockReview.issues[0], ...over }) as Issue;
  const issues = [
    issue({ patternId: 'a', severity: 'critical', category: 'bug' }),
    issue({ patternId: 'b', severity: 'suggestion', category: 'readability' }),
    issue({ patternId: 'c', severity: 'warning', category: 'style' }),
    issue({ patternId: 'd', severity: 'warning', category: 'edge-case' }),
  ];
  const settings = mergeSettings(user, {
    minSeverity: 'warning',
    categories: { style: false },
    limits: { maxIssuesPerBlock: 1 },
  });
  expect(filterIssues(issues, settings).map((i) => i.patternId)).toEqual(['a']);
  expect(filterIssues(issues, { ...settings, maxIssues: 3 }).map((i) => i.patternId)).toEqual([
    'a',
    'd',
  ]);
});

test('schemas/adviser-config.schema.json совпадает со схемой (обновить: npx vitest -u)', async () => {
  const schema = z.toJSONSchema(projectConfigSchema, { target: 'draft-7', io: 'input' });
  await expect(`${JSON.stringify(schema, null, 2)}\n`).toMatchFileSnapshot(
    '../../schemas/adviser-config.schema.json',
  );
});
