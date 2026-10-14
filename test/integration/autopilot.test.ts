import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

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

const adviserLines = (uri: vscode.Uri) =>
  vscode.languages
    .getDiagnostics(uri)
    .filter((d) => d.source === 'Adviser')
    .map((d) => d.range.start.line)
    .sort();

suite('Автопилот', () => {
  const config = () => vscode.workspace.getConfiguration('adviser');
  let file: string;

  suiteSetup(async () => {
    await config().update('provider', 'mock', vscode.ConfigurationTarget.Global);
    await config().update('mode', 'mentor', vscode.ConfigurationTarget.Global);
    file = path.join(os.tmpdir(), `adviser-autopilot-${Date.now()}.js`);
    fs.writeFileSync(
      file,
      'function a(items) {\n  return items[0];\n}\n\nfunction b(items) {\n  return items[1];\n}\n',
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await config().update('mode', undefined, vscode.ConfigurationTarget.Global);
    fs.rmSync(file, { force: true });
  });

  test('сохранение: разбирает только изменённую функцию, правки в комментариях и режим «Вручную» — нет', async () => {
    const doc = await vscode.workspace.openTextDocument(file);
    const editor = await vscode.window.showTextDocument(doc);
    // Автопилот видит функции через языковой сервер — ждём, пока он их отдаст.
    await waitFor(async () => {
      const symbols = await vscode.commands.executeCommand<unknown[]>(
        'vscode.executeDocumentSymbolProvider',
        doc.uri,
      );
      return symbols?.length === 2 ? symbols : undefined;
    });
    const save = () => vscode.commands.executeCommand('workbench.action.files.save');

    await editor.edit((e) => e.insert(new vscode.Position(5, 0), '  const second = items[1];\n'));
    await save();
    // b теперь на строках 4–7. Mock: warning на 2-й строке функции, suggestion с 1-й.
    const lines = await waitFor(() => {
      const found = adviserLines(doc.uri);
      return found.length ? found : undefined;
    });
    assert.deepStrictEqual(lines, [4, 5]);

    await editor.edit((e) => e.insert(new vscode.Position(1, 0), '  // первый элемент\n'));
    await save();
    await sleep(1500);
    assert.deepStrictEqual(adviserLines(doc.uri), [4, 5], 'правка только в комментарии');

    await config().update('mode', 'manual', vscode.ConfigurationTarget.Global);
    await editor.edit((e) => e.insert(new vscode.Position(2, 0), '  items.sort();\n'));
    await save();
    await sleep(1500);
    assert.deepStrictEqual(adviserLines(doc.uri), [4, 5], 'режим «Вручную»');

    // Снова «Наставник»: изменённая функция a ждала и разбирается при следующем сохранении.
    await config().update('mode', 'mentor', vscode.ConfigurationTarget.Global);
    await editor.edit((e) => e.insert(new vscode.Position(3, 0), '  // конец\n'));
    await save();
    await waitFor(() => (adviserLines(doc.uri).includes(0) ? true : undefined));
  });

  test('файл перечитан с диска (git checkout) — это не правки человека', async () => {
    const doc = vscode.window.activeTextEditor!.document;
    const before = adviserLines(doc.uri);
    const end = doc.lineCount;
    fs.writeFileSync(file, `${doc.getText()}\nfunction c(items) {\n  return items[2];\n}\n`);
    await waitFor(() => (doc.getText().includes('function c') ? true : undefined));
    await sleep(1000);

    // Правка в комментарии новой функции: если бы перечитывание считалось правкой, c разобрали бы.
    const editor = vscode.window.activeTextEditor!;
    await editor.edit((e) => e.insert(new vscode.Position(end + 2, 0), '  // третий\n'));
    await vscode.commands.executeCommand('workbench.action.files.save');
    await sleep(1500);
    assert.deepStrictEqual(adviserLines(doc.uri), before);
  });
});
