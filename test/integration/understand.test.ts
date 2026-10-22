import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

/** Часть TestApi из src/extension.ts (см. journal.test.ts). */
interface TestApi {
  lastMockRequest(): { prompt: string } | undefined;
}

interface GitRepository {
  status(): Promise<void>;
}

suite('Понимаю ли я изменения', () => {
  const config = () => vscode.workspace.getConfiguration('adviser');
  let dir: string;
  let api: TestApi;

  suiteSetup(async () => {
    await config().update('provider', 'mock', vscode.ConfigurationTarget.Global);
    await config().update('mode', 'manual', vscode.ConfigurationTarget.Global);
    api = (await vscode.extensions
      .getExtension('undefined_publisher.adviser')!
      .activate()) as TestApi;
    // Свой репозиторий во временной папке: изменения в нём известны заранее.
    dir = mkdtempSync(join(tmpdir(), 'adviser-git-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
    git('init', '-q');
    writeFileSync(join(dir, 'calc.js'), 'function add(a, b) {\n  return a + b;\n}\n');
    git('add', '.');
    git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'init');
    writeFileSync(
      join(dir, 'calc.js'),
      'function add(a, b) {\n  return a + b;\n}\n\nfunction changed_marker(x) {\n  return x * 2;\n}\n',
    );
    writeFileSync(join(dir, 'extra.js'), 'function extra_marker() {}\n');
    writeFileSync(join(dir, '.env'), 'TOKEN=env_marker\n');
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // На Windows папку может ещё держать git из VS Code; это временная папка ОС.
    }
    await config().update('mode', undefined, vscode.ConfigurationTarget.Global);
  });

  test('вопросы по изменениям относительно коммита: правка, новый файл, .env не уходит', async () => {
    await vscode.commands.executeCommand('git.openRepository', dir);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(join(dir, 'calc.js')));
    await vscode.window.showTextDocument(doc);
    const gitApi = vscode.extensions
      .getExtension<{ getAPI(v: 1): { getRepository(u: vscode.Uri): GitRepository | null } }>(
        'vscode.git',
      )!
      .exports.getAPI(1);
    await gitApi.getRepository(doc.uri)!.status();

    await vscode.commands.executeCommand('adviser.understandChanges', {
      answers: ['mock: right', 'не знаю'],
    });
    // Последний запрос — оценка ответов: в нём и изменения, и ответы.
    const prompt = api.lastMockRequest()!.prompt;
    assert.match(prompt, /### calc\.js\n[\s\S]*\+function changed_marker/);
    assert.match(prompt, /### extra\.js\n\+function extra_marker/);
    assert.doesNotMatch(prompt, /env_marker/);
    assert.match(prompt, /<answer>mock: right<\/answer>[\s\S]*<answer>не знаю<\/answer>/);
    // Предпросмотр Markdown открывается не сразу.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => t.label));
    assert.ok(
      tabs.some((label) => label.includes('changes.md')),
      `отчёт не открылся: ${tabs.join(', ')}`,
    );
  });
});
