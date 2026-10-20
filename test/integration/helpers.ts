import * as assert from 'assert';
import * as vscode from 'vscode';

export async function hoverText(uri: vscode.Uri, position: vscode.Position) {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    uri,
    position,
  );
  return hovers
    .flatMap((h) => h.contents)
    .map((c) => (typeof c === 'string' ? c : c.value))
    .join('\n');
}

/** Нажимает ссылку из hover так же, как VS Code: команда и аргументы берутся из ссылки. */
export async function click(text: string, label: string) {
  const link = new RegExp(`\\[${label}\\]\\(command:([\\w.]+)\\?([^)]+)\\)`).exec(text);
  assert.ok(link, `в hover нет кнопки «${label}»:\n${text}`);
  const args = JSON.parse(decodeURIComponent(link[2])) as unknown[];
  await vscode.commands.executeCommand(link[1], ...args);
}
