import * as assert from 'assert';
import * as vscode from 'vscode';

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
});
