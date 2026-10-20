import * as assert from 'assert';
import * as vscode from 'vscode';
import { click, hoverText } from './helpers';

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

    // В mock-ответе warning на строке 2 функции и suggestion на всю функцию; функция с 0-й строки файла.
    const [diagnostic, suggestion, ...rest] = vscode.languages.getDiagnostics(doc.uri);
    assert.strictEqual(rest.length, 0);
    assert.strictEqual(suggestion.severity, vscode.DiagnosticSeverity.Hint);
    assert.strictEqual(diagnostic.source, 'Adviser');
    assert.strictEqual(diagnostic.range.start.line, 1);
    assert.strictEqual(diagnostic.range.start.character, 2);
    assert.strictEqual(diagnostic.severity, vscode.DiagnosticSeverity.Information);
    assert.match(diagnostic.message, /Mock-намёк/);

    // Внутри suggestion, но дальше двух первых символов: VS Code его текст здесь не покажет, и мы тоже.
    const at = new vscode.Position(1, 5);
    let text = await hoverText(doc.uri, at);
    assert.doesNotMatch(text, /Mock-объяснение|исправленный код|«/);

    await click(text, 'Объяснить');
    text = await hoverText(doc.uri, at);
    assert.match(text, /Mock-объяснение/);
    assert.doesNotMatch(text, /исправленный код/);

    await click(text, 'Показать решение');
    text = await hoverText(doc.uri, at);
    assert.match(text, /Mock-объяснение/);
    assert.match(text, /исправленный код/);
    assert.doesNotMatch(text, /\[Объяснить\]|\[Показать решение\]|совета/);

    const dots = new vscode.Position(0, 1);
    text = await hoverText(doc.uri, dots);
    await click(text, 'Объяснить');
    assert.match(await hoverText(doc.uri, dots), /Mock-объяснение совета/);
  });
});
