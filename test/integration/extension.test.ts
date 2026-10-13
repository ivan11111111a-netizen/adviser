import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Разбор функции', () => {
  suiteSetup(async () => {
    await vscode.workspace
      .getConfiguration('adviser')
      .update('provider', 'mock', vscode.ConfigurationTarget.Global);
  });

  test('mock-ответ превращается в подчёркивание и hover', async () => {
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

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      new vscode.Position(1, 5),
    );
    const text = hovers
      .flatMap((h) => h.contents)
      .map((c) => (typeof c === 'string' ? c : c.value))
      .join('\n');
    assert.match(text, /Mock-объяснение/);
  });
});
