import * as assert from 'assert';
import * as vscode from 'vscode';
import { hoverText } from './helpers';

/** Часть TestApi из src/extension.ts (см. journal.test.ts). */
interface TestApi {
  lastMockRequest(): { prompt: string } | undefined;
}

/** Ноутбук Jupyter с одной ячейкой Python. Открывает его встроенное расширение VS Code (ipynb). */
const ipynb = (source: string) =>
  JSON.stringify({
    cells: [{ cell_type: 'code', metadata: {}, source, outputs: [], execution_count: null }],
    metadata: { language_info: { name: 'python' } },
    nbformat: 4,
    nbformat_minor: 5,
  });

/** Открывает ноутбук и ставит курсор во вторую строку его первой ячейки. */
async function openCell(uri: vscode.Uri, source: string): Promise<vscode.TextEditor> {
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(ipynb(source)));
  const notebook = await vscode.workspace.openNotebookDocument(uri);
  await vscode.window.showNotebookDocument(notebook);
  await vscode.commands.executeCommand('notebook.cell.edit');
  const editor = vscode.window.activeTextEditor!;
  assert.strictEqual(editor.document.uri.scheme, 'vscode-notebook-cell');
  editor.selection = new vscode.Selection(1, 6, 1, 6);
  return editor;
}

suite('Ноутбуки', () => {
  const config = () => vscode.workspace.getConfiguration('adviser');
  const folder = () => vscode.workspace.workspaceFolders![0].uri;
  const created: vscode.Uri[] = [];
  let api: TestApi;

  suiteSetup(async () => {
    await config().update('provider', 'mock', vscode.ConfigurationTarget.Global);
    await config().update('mode', 'manual', vscode.ConfigurationTarget.Global);
    api = (await vscode.extensions
      .getExtension('undefined_publisher.adviser')!
      .activate()) as TestApi;
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    for (const uri of created) {
      await vscode.workspace.fs.delete(uri);
    }
    await config().update('mode', undefined, vscode.ConfigurationTarget.Global);
  });

  test('ячейка разбирается командой, по настройкам своего проекта: подчёркивание и кнопки в hover', async () => {
    const uri = vscode.Uri.joinPath(folder(), 'study.ipynb');
    created.push(uri);
    // Три строки: второе замечание mock — на строках 1–3.
    const editor = await openCell(uri, 'def first(items):\n    item = items[0]\n    return item\n');
    await vscode.commands.executeCommand('adviser.reviewFunction');
    const cell = editor.document.uri;
    // minSeverity: warning из .adviser/config.json тестового проекта: совет (unclear-name) скрыт.
    assert.deepStrictEqual(
      vscode.languages.getDiagnostics(cell).map((d) => d.code),
      ['empty-collection'],
    );
    assert.match(await hoverText(cell, new vscode.Position(1, 6)), /\[Объяснить\]/);
  });

  test('ноутбук из ignore не отправляется, как и обычный файл', async () => {
    // generated/ — в ignore тестового проекта; сама папка с фикстурой остаётся.
    const uri = vscode.Uri.joinPath(folder(), 'generated', 'secret.ipynb');
    created.push(uri);
    const editor = await openCell(uri, 'def only_here_marker(x):\n    return x\n');
    await vscode.commands.executeCommand('adviser.reviewFunction');
    assert.strictEqual(vscode.languages.getDiagnostics(editor.document.uri).length, 0);
    assert.doesNotMatch(api.lastMockRequest()?.prompt ?? '', /only_here_marker/);
  });
});
