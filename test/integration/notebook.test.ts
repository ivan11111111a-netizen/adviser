import * as assert from 'assert';
import * as vscode from 'vscode';
import { hoverText } from './helpers';

/** Часть TestApi из src/extension.ts (см. journal.test.ts). */
interface TestApi {
  lastMockRequest(): { prompt: string } | undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(get: () => Promise<T | undefined> | T | undefined): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await get();
    if (value !== undefined) {
      return value;
    }
    await sleep(100);
  }
  throw new Error('не дождались');
}

/** Ноутбук Jupyter с одной ячейкой. Открывает его встроенное расширение VS Code (ipynb). */
const ipynb = (source: string, language: string) =>
  JSON.stringify({
    cells: [{ cell_type: 'code', metadata: {}, source, outputs: [], execution_count: null }],
    metadata: { language_info: { name: language } },
    nbformat: 4,
    nbformat_minor: 5,
  });

/** Открывает ноутбук и ставит курсор во вторую строку его первой ячейки. */
async function openCell(
  uri: vscode.Uri,
  source: string,
  language = 'python',
): Promise<vscode.TextEditor> {
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(ipynb(source, language)));
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

  test('автопилот: правка в ячейке разбирается, когда курсор уходит из функции', async () => {
    // У текстового документа ячейки isDirty всегда false — несохранённым бывает только ноутбук.
    // Правка в ячейке не должна выглядеть для автопилота как файл, перечитанный с диска.
    await config().update('mode', 'mentor', vscode.ConfigurationTarget.Global);
    const uri = vscode.Uri.joinPath(folder(), 'auto.ipynb');
    created.push(uri);
    // JavaScript: функции ячейки отдаёт встроенный языковой сервер TypeScript, Pylance в тестах нет.
    const editor = await openCell(
      uri,
      'function first(items) {\n  return items[0];\n}\n' +
        'function last(items) {\n  return items[items.length - 1];\n}\nfirst([]);\n',
      'javascript',
    );
    const cell = editor.document.uri;
    await waitFor(async () => {
      const symbols = await vscode.commands.executeCommand<unknown[]>(
        'vscode.executeDocumentSymbolProvider',
        cell,
      );
      return symbols?.length ? symbols : undefined;
    });
    await editor.edit((e) => e.insert(new vscode.Position(1, 0), '  items.sort();\n'));
    // Курсор в first, потом ниже обеих функций — уход из функции.
    editor.selection = new vscode.Selection(1, 2, 1, 2);
    await sleep(1500);
    editor.selection = new vscode.Selection(7, 0, 7, 0);
    try {
      // minSeverity: warning тестового проекта оставляет одно замечание mock — на 2-й строке.
      const lines = await waitFor(() => {
        const found = vscode.languages.getDiagnostics(cell).map((d) => d.range.start.line);
        return found.length ? found : undefined;
      });
      assert.deepStrictEqual(lines, [1]);

      // Сохранение ноутбука — тоже повод: событий о сохранении ячеек VS Code не шлёт.
      // Правим last: first только что разобрана и ждёт cooldown.
      await editor.edit((e) => e.insert(new vscode.Position(5, 0), '  items.reverse();\n'));
      await vscode.commands.executeCommand('workbench.action.files.save');
      await waitFor(() =>
        api.lastMockRequest()?.prompt.includes('items.reverse') ? true : undefined,
      );
    } finally {
      await config().update('mode', 'manual', vscode.ConfigurationTarget.Global);
    }
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
