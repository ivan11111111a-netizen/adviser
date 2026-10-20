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
});
