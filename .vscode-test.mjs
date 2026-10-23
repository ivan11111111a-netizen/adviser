import { defineConfig } from '@vscode/test-cli';

const brokenInstall = process.platform === 'win32' && process.cwd().includes(' ');

const common = {
  // Папка с .adviser/config.json — для теста настроек проекта; остальные тесты работают вне неё.
  workspaceFolder: 'test/fixtures/project',
  // Первый разбор ждёт старта языкового сервера ради символов; в CI это дольше 2 с по умолчанию.
  mocha: { timeout: 30_000 },
  // Тесты ждут русский интерфейс: так заодно проверяется перевод из l10n/bundle.l10n.ru.json.
  // Без языкового пакета VS Code с --locale ru остаётся английским и переводы расширений не грузит.
  // На Windows test-cli ставит расширения через shell и рвёт путь с пробелом («My Folder»):
  // там пакет ставится руками, см. README («Разработка»).
  installExtensions: brokenInstall ? [] : ['ms-ceintl.vscode-language-pack-ru'],
  launchArgs: ['--locale', 'ru'],
};

export default defineConfig([
  // Первый запуск с языковым пакетом только готовит кэш переводов (user-data/clp) и идёт
  // по-английски. В CI каждый запуск — первый, поэтому сначала пустой прогон.
  { label: 'warmup', files: 'out/test/integration/warmup/*.test.js', ...common },
  { label: 'integration', files: 'out/test/integration/*.test.js', ...common },
]);
