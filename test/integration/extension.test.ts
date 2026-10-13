import * as assert from 'assert';
import * as vscode from 'vscode';

async function hoverText(uri: vscode.Uri, position: vscode.Position) {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    uri,
    position,
  );
  return hovers
    .flatMap((h) => h.contents)
    .map((c) => (typeof c === 'string' ? c : c.value))
    .join('\n');
}

/** Нажимает кнопку из hover так же, как VS Code: команда и аргументы берутся из ссылки. */
async function click(text: string, label: string) {
  const link = new RegExp(`\\[${label}\\]\\(command:([\\w.]+)\\?([^)]+)\\)`).exec(text);
  assert.ok(link, `в hover нет кнопки «${label}»:\n${text}`);
  const args = JSON.parse(decodeURIComponent(link[2])) as unknown[];
  await vscode.commands.executeCommand(link[1], ...args);
}

suite('Разбор функции', () => {
  suiteSetup(async () => {
    await vscode.workspace
      .getConfiguration('adviser')
      .update('provider', 'mock', vscode.ConfigurationTarget.Global);
  });

  test('mock-ответ: подчёркивание с намёком, ступени открываются кнопками из hover', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'javascript',
      content: 'function first(items) {\n  return items[0].price;\n}\n',
    });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(1, 2, 1, 2);

    await vscode.commands.executeCommand('adviser.reviewFunction');

    // В mock-ответе замечание на строке 2 функции, функция начинается со строки 0 файла.
    const [diagnostic, ...rest] = vscode.languages.getDiagnostics(doc.uri);
    assert.strictEqual(rest.length, 0);
    assert.strictEqual(diagnostic.source, 'Adviser');
    assert.strictEqual(diagnostic.range.start.line, 1);
    assert.strictEqual(diagnostic.range.start.character, 2);
    assert.strictEqual(diagnostic.severity, vscode.DiagnosticSeverity.Information);
    assert.match(diagnostic.message, /Mock-намёк/);

    const at = new vscode.Position(1, 5);
    let text = await hoverText(doc.uri, at);
    assert.doesNotMatch(text, /Mock-объяснение|исправленный код/);

    await click(text, 'Объяснить');
    text = await hoverText(doc.uri, at);
    assert.match(text, /Mock-объяснение/);
    assert.doesNotMatch(text, /исправленный код/);

    await click(text, 'Показать решение');
    text = await hoverText(doc.uri, at);
    assert.match(text, /Mock-объяснение/);
    assert.match(text, /исправленный код/);
    assert.doesNotMatch(text, /\[Объяснить\]|\[Показать решение\]/);
  });
});
