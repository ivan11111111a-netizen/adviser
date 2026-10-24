import * as assert from 'assert';
import * as vscode from 'vscode';
import { hoverText } from './helpers';

suite('Окружение тестов', () => {
  test('VS Code на русском, перевод Adviser подхвачен', async () => {
    await vscode.extensions.getExtension('undefined_publisher.adviser')!.activate();
    assert.strictEqual(
      vscode.env.language,
      'ru',
      'нужен русский языковой пакет: code --extensions-dir .vscode-test/extensions --user-data-dir .vscode-test/user-data --install-extension ms-ceintl.vscode-language-pack-ru',
    );
    assert.strictEqual(vscode.l10n.t('Explain'), 'Объяснить');
  });

  test('схема .adviser/config.json — на языке интерфейса (адрес — из package.nls.ru.json)', async () => {
    const root = vscode.workspace.workspaceFolders![0].uri;
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(root, '.adviser', 'config.json'),
    );
    // Вторая строка: «  "minSeverity": "warning",». Языковой сервер JSON грузит схему не сразу.
    const at = new vscode.Position(1, 5);
    let text = '';
    for (let i = 0; i < 50 && !text.includes('серьёзность'); i++) {
      text = await hoverText(doc.uri, at);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.match(text, /Самая лёгкая серьёзность/);
  });
});
