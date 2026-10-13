import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  // Первый разбор ждёт старта языкового сервера ради символов; в CI это дольше 2 с по умолчанию.
  mocha: { timeout: 30_000 },
});
