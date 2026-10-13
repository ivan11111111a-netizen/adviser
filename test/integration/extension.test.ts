import * as vscode from 'vscode';

suite('Расширение', () => {
  test('активируется и выполняет adviser.hello', async () => {
    // Если расширение не активировалось, executeCommand бросит «command not found».
    await vscode.commands.executeCommand('adviser.hello');
  });
});
