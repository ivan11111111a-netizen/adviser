import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const adviser = (uri: vscode.Uri) =>
  vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'Adviser');

/** Файл из test/fixtures/project — она открыта как папка проекта, в ней .adviser/config.json. */
async function reviewIn(file: string) {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const doc = await vscode.workspace.openTextDocument(path.join(root, file));
  const editor = await vscode.window.showTextDocument(doc);
  editor.selection = new vscode.Selection(1, 2, 1, 2);
  await vscode.commands.executeCommand('adviser.reviewFunction');
  return doc;
}

suite('Настройки проекта', () => {
  suiteSetup(async () => {
    const config = vscode.workspace.getConfiguration('adviser');
    await config.update('provider', 'mock', vscode.ConfigurationTarget.Global);
    await config.update('mode', 'manual', vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    await vscode.workspace
      .getConfiguration('adviser')
      .update('mode', undefined, vscode.ConfigurationTarget.Global);
  });

  test('minSeverity: warning — совет (suggestion) не показывается', async () => {
    const doc = await reviewIn('cart.js');
    assert.deepStrictEqual(
      adviser(doc.uri).map((d) => d.code),
      ['empty-collection'],
    );
  });

  test('файл из ignore не отправляется', async () => {
    const doc = await reviewIn('generated/api.js');
    assert.strictEqual(adviser(doc.uri).length, 0);
  });

  test('файл из .adviserignore не отправляется', async () => {
    const doc = await reviewIn('answers/task1.js');
    assert.strictEqual(adviser(doc.uri).length, 0);
  });

  test('окружение функции уходит модели, только если промпт его объясняет', async () => {
    const api = (await vscode.extensions
      .getExtension('undefined_publisher.adviser')!
      .activate()) as TestApi;
    const config = vscode.workspace.getConfiguration('adviser');

    await reviewIn('cart.js');
    assert.doesNotMatch(api.lastMockRequest()!.prompt, /<context>/, 'v1 про окружение не знает');

    await config.update('dev.prompt', 'mentor.v2', vscode.ConfigurationTarget.Global);
    try {
      await reviewIn('cart.js');
      const { system, prompt } = api.lastMockRequest()!;
      assert.match(system, /Между тегами <context>/);
      assert.match(prompt, /<context>\nЗависимости проекта: lodash \^4\.17\.21\n<\/context>/);
      // Правила проекта — в системной части, как данные в своих тегах.
      assert.match(
        system,
        /<rules>\n### \.adviser\/rules\.md\nИмена функций — глаголом: getTotal, а не total\.\n<\/rules>/,
      );
    } finally {
      await config.update('dev.prompt', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('в окружении — вызываемые функции из других файлов, кроме тех, что в ignore', async () => {
    const api = (await vscode.extensions
      .getExtension('undefined_publisher.adviser')!
      .activate()) as TestApi;
    const config = vscode.workspace.getConfiguration('adviser');
    await config.update('dev.prompt', 'mentor.v2', vscode.ConfigurationTarget.Global);
    try {
      const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
      const doc = await vscode.workspace.openTextDocument(path.join(root, 'checkout.js'));
      const editor = await vscode.window.showTextDocument(doc);
      // Пока TypeScript грузит проект, определение ведёт только на import в этом же файле.
      for (let i = 0; i < 100; i++) {
        const defs = await vscode.commands.executeCommand<vscode.LocationLink[]>(
          'vscode.executeDefinitionProvider',
          doc.uri,
          new vscode.Position(5, 9),
        );
        if (defs?.[0]?.targetUri.path.endsWith('money.js')) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      editor.selection = new vscode.Selection(4, 2, 4, 2);
      await vscode.commands.executeCommand('adviser.reviewFunction');
      const { prompt } = api.lastMockRequest()!;
      assert.match(
        prompt,
        /Что функция вызывает из других файлов:\nutils\/money\.js:1 \| export function round\(value, digits = 2\) \{/,
      );
      // Сам import есть в скелете файла, но строки из игнорируемого файла в окружение не идут.
      assert.doesNotMatch(prompt, /generated\/api\.js:\d/);
    } finally {
      await config.update('dev.prompt', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

/** Часть TestApi из src/extension.ts: импортировать его тесты не могут (см. journal.test.ts). */
interface TestApi {
  lastMockRequest(): { system: string; prompt: string } | undefined;
}
