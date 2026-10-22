import * as assert from 'assert';
import * as vscode from 'vscode';

/** Часть TestApi из src/extension.ts: импортировать его тесты не могут (см. journal.test.ts). */
interface TestApi {
  lastMockRequest(): { system: string; prompt: string } | undefined;
}

suite('Приватность', () => {
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

  test('провайдер Copilot без Copilot — отказ без падения, замечаний нет', async () => {
    const config = vscode.workspace.getConfiguration('adviser');
    await config.update('provider', 'copilot', vscode.ConfigurationTarget.Global);
    try {
      const doc = await vscode.workspace.openTextDocument({
        language: 'javascript',
        content: 'function f(items) {\n  return items[0];\n}\n',
      });
      const editor = await vscode.window.showTextDocument(doc);
      editor.selection = new vscode.Selection(1, 2, 1, 2);
      await vscode.commands.executeCommand('adviser.reviewFunction');
      assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 0);
    } finally {
      await config.update('provider', 'mock', vscode.ConfigurationTarget.Global);
    }
  });

  test('ключ в коде маскируется до отправки, номера строк те же', async () => {
    const api = (await vscode.extensions
      .getExtension('undefined_publisher.adviser')!
      .activate()) as TestApi;
    const doc = await vscode.workspace.openTextDocument({
      language: 'javascript',
      content: [
        'function connect() {',
        "  const apiKey = 'sk-proj-Xy9Xy9Xy9Xy9Xy9Xy9Xy9Xy9Xy9';",
        "  return fetch('https://api.example.com', { headers: { key: apiKey } });",
        '}',
      ].join('\n'),
    });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(1, 2, 1, 2);
    await vscode.commands.executeCommand('adviser.reviewFunction');

    const { prompt } = api.lastMockRequest()!;
    assert.doesNotMatch(prompt, /Xy9Xy9/);
    assert.match(prompt, /2 \|\s+const apiKey = '<секрет скрыт>';\n3 \| /);
  });
});
