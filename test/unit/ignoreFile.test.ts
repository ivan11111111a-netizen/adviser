import { expect, test } from 'vitest';
import { gitignoreToGlobs } from '../../src/core/ignoreFile';

test('gitignoreToGlobs: на любой глубине, от корня, только папки, комментарии', () => {
  expect(
    gitignoreToGlobs(
      [
        '# секреты',
        '',
        'secrets.json',
        '/build',
        'homework/answers/',
        'data/*.csv',
        '!keep.js',
      ].join('\n'),
    ),
  ).toEqual({
    globs: [
      '**/secrets.json/**',
      '**/secrets.json',
      'build/**',
      'build',
      'homework/answers/**',
      'data/*.csv/**',
      'data/*.csv',
    ],
    skipped: ['!keep.js'],
  });
});
