import * as assert from 'assert';
import * as vscode from 'vscode';
import { click, hoverText } from './helpers';

/**
 * Часть TestApi из src/extension.ts. Импортировать его нельзя: тесты компилируются в CommonJS,
 * а src тянет за собой ai, который выходит только как ESM.
 */
interface Entry {
  id: string;
  patternId: string;
  step: number;
  file: string;
  line: number;
  resolvedAt?: number;
  feedback?: string;
}
type Node = { kind: string; patternId?: string };
interface TestApi {
  journal: { all(): readonly Entry[]; get(id: string): Entry | undefined };
  journalView: vscode.TreeDataProvider<Node>;
}

/** Разбор командой новой безымянной функции; mock даёт empty-collection на строке 2 и unclear-name. */
async function reviewNew(content = 'function first(items) {\n  return items[0].price;\n}\n') {
  const doc = await vscode.workspace.openTextDocument({ language: 'javascript', content });
  const editor = await vscode.window.showTextDocument(doc);
  editor.selection = new vscode.Selection(1, 2, 1, 2);
  await vscode.commands.executeCommand('adviser.reviewFunction');
  return { doc, editor };
}

suite('Журнал ошибок', () => {
  const config = () => vscode.workspace.getConfiguration('adviser');
  let api: TestApi;

  suiteSetup(async () => {
    await config().update('provider', 'mock', vscode.ConfigurationTarget.Global);
    // Только команда: автопилот здесь не нужен.
    await config().update('mode', 'manual', vscode.ConfigurationTarget.Global);
    api = (await vscode.extensions
      .getExtension('undefined_publisher.adviser')!
      .activate()) as TestApi;
  });

  suiteTeardown(async () => {
    await config().update('mode', undefined, vscode.ConfigurationTarget.Global);
  });

  test('случай записывается, ступень растёт, повторный разбор продолжает случай, исправленный закрывается', async () => {
    const before = api.journal.all().length;
    const { doc, editor } = await reviewNew();
    const added = api.journal.all().slice(before);
    assert.deepStrictEqual(
      added.map((e) => [e.patternId, e.step, e.file, e.line]),
      [
        ['empty-collection', 1, doc.uri.toString(), 1],
        ['unclear-name', 1, doc.uri.toString(), 0],
      ],
    );

    const at = new vscode.Position(1, 5);
    await click(await hoverText(doc.uri, at), 'Объяснить');
    assert.strictEqual(api.journal.get(added[0].id)?.step, 2);

    // Тот же код ещё раз: те же случаи, открытая ступень сохраняется.
    await vscode.commands.executeCommand('adviser.reviewFunction');
    assert.strictEqual(api.journal.all().length, before + 2);
    assert.match(await hoverText(doc.uri, at), /Mock-объяснение/);

    // Код исправлен: mock больше не находит ошибок — случаи закрыты.
    await editor.edit((e) => e.insert(new vscode.Position(1, 0), '  // mock: clean\n'));
    await vscode.commands.executeCommand('adviser.reviewFunction');
    assert.ok(added.every((e) => api.journal.get(e.id)?.resolvedAt !== undefined));
    assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 0);
  });

  test('правка строк замечания прячет его до нового разбора, а разбор продолжает тот же случай', async () => {
    const { doc, editor } = await reviewNew();
    assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 2);
    const before = api.journal.all().length;

    await editor.edit((e) => e.insert(new vscode.Position(1, 24), ' // цена'));
    assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 0);
    assert.strictEqual((await hoverText(doc.uri, new vscode.Position(1, 5))).trim(), '');

    await vscode.commands.executeCommand('adviser.reviewFunction');
    assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 2);
    assert.strictEqual(api.journal.all().length, before, 'новых случаев нет — это те же');
  });

  test('лампочка: «понял» прячет замечание и пишет ответ в журнал, «не показывать» скрывает тип', async () => {
    const { doc } = await reviewNew();
    const at = new vscode.Range(1, 5, 1, 5);
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      doc.uri,
      at,
    );
    const titles = actions.map((a) => a.title);
    assert.ok(titles.includes('Adviser: понял'), titles.join(', '));
    assert.ok(
      titles.includes('Adviser: больше не показывать «не учтён пустой список, массив или строка»'),
    );

    const understood = actions.find((a) => a.title === 'Adviser: понял')!.command!;
    await vscode.commands.executeCommand(understood.command, ...understood.arguments!);
    const id = (understood.arguments![0] as { id: string }).id;
    assert.strictEqual(api.journal.get(id)?.feedback, 'understood');
    assert.deepStrictEqual(
      vscode.languages.getDiagnostics(doc.uri).map((d) => d.code),
      ['unclear-name'],
    );
    // Повторный разбор того же кода ответ помнит: замечание не возвращается.
    await vscode.commands.executeCommand('adviser.reviewFunction');
    assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 1);

    const config = vscode.workspace.getConfiguration('adviser');
    try {
      await vscode.commands.executeCommand('adviser.hidePattern', { patternId: 'unclear-name' });
      // Объект настроек — снимок: после update его надо взять заново.
      assert.deepStrictEqual(vscode.workspace.getConfiguration('adviser').get('hiddenPatterns'), [
        'unclear-name',
      ]);
      assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 0);
      const { doc: next } = await reviewNew();
      assert.deepStrictEqual(
        vscode.languages.getDiagnostics(next.uri).map((d) => d.code),
        ['empty-collection'],
      );
    } finally {
      await config.update('hiddenPatterns', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('«применить решение» — только после «Показать решение», правка с предпросмотром и отступом места', async () => {
    const { doc } = await reviewNew();
    const at = new vscode.Range(1, 5, 1, 5);
    const titles = async () =>
      (
        await vscode.commands.executeCommand<vscode.CodeAction[]>(
          'vscode.executeCodeActionProvider',
          doc.uri,
          at,
        )
      ).map((a) => a.title);
    assert.ok(!(await titles()).includes('Adviser: применить решение'), 'ступени не обходим');

    await click(await hoverText(doc.uri, at.start), 'Показать решение');
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      doc.uri,
      at,
    );
    const apply = actions.find((a) => a.title === 'Adviser: применить решение');
    assert.ok(apply?.edit, actions.map((a) => a.title).join(', '));
    const [[uri, [change]]] = apply.edit.entries();
    assert.strictEqual(uri.toString(), doc.uri.toString());
    assert.strictEqual(change.newText, '  // исправленный код');
    assert.strictEqual(change.range.start.line, 1);
  });

  test('в третий раз за неделю hover напоминает о повторе и ведёт к прошлому случаю', async () => {
    await reviewNew();
    const { doc: previous } = await reviewNew();
    const { doc } = await reviewNew();

    const text = await hoverText(doc.uri, new vscode.Position(1, 5));
    assert.match(text, /Ты так уже делал \d+ раза? на этой неделе/);
    await click(text, 'Прошлый случай');
    const editor = vscode.window.activeTextEditor!;
    assert.strictEqual(editor.document.uri.toString(), previous.uri.toString());
    assert.strictEqual(editor.selection.active.line, 1);
  });

  test('панель: неделя, частые ошибки со случаями; отчёт открывается предпросмотром', async () => {
    const view = api.journalView;
    const roots = (await view.getChildren())!;
    assert.deepStrictEqual(
      roots.map((n) => n.kind),
      ['week', 'group', 'group'],
    );
    const frequent = (await view.getChildren(roots[1]))!;
    const pattern = frequent.find((n) => n.patternId === 'empty-collection');
    assert.ok(pattern, 'empty-collection среди частых');
    assert.match(
      String((await view.getTreeItem(pattern)).label),
      /^\d+ · не учтён пустой список, массив или строка$/,
    );
    const cases = (await view.getChildren(pattern))!;
    assert.ok(cases.length >= 3);
    const item = await view.getTreeItem(cases[0]);
    assert.strictEqual(item.command?.command, 'adviser.openCase');

    await vscode.commands.executeCommand('adviser.weeklyReport');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => t.label));
    assert.ok(
      tabs.some((label) => label.includes('report.md')),
      `нет вкладки отчёта: ${tabs.join(', ')}`,
    );
  });
});
