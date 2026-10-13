import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // Учебный код с ошибками нарочно
  { ignores: ['test/fixtures/**', 'evals/cases/**'] },
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'warn',
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],
      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
    },
  },
  {
    // Ядро — чистая логика, которую гоняют юнит-тесты и eval без VS Code (AGENTS.md).
    files: ['src/core/**/*.ts', 'test/unit/**/*.ts', 'evals/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              message:
                'src/core не импортирует vscode: работа с редактором — в адаптерах src/editor/.',
            },
          ],
        },
      ],
    },
  },
);
