import * as vscode from 'vscode';
import { LEVELS, type Level } from '../core/promptBuilder';
import { checkOpenRouterModel, OLLAMA_URL, OPENROUTER_URL, parseModelList } from '../core/setup';
import { setApiKey } from '../config/provider';
import { readBundled, translate } from './bundled';
import { documentSymbols } from './symbols';

export const WALKTHROUGH = 'adviser.start';
const WELCOMED_KEY = 'adviser.welcomed';

/** Мастер пишет в настройки пользователя: провайдер и модель проект задать не может. */
const USER = vscode.ConfigurationTarget.Global;
const config = () => vscode.workspace.getConfiguration('adviser');

/** Мастер открывается сам один раз — при первом запуске расширения. Тестам он не нужен. */
export async function welcome(context: vscode.ExtensionContext) {
  if (
    context.extensionMode === vscode.ExtensionMode.Test ||
    context.globalState.get<boolean>(WELCOMED_KEY)
  ) {
    return;
  }
  await context.globalState.update(WELCOMED_KEY, true);
  await openWalkthrough(context);
}

export async function openWalkthrough(context: vscode.ExtensionContext) {
  await vscode.commands.executeCommand(
    'workbench.action.openWalkthrough',
    `${context.extension.id}#${WALKTHROUGH}`,
    false,
  );
}

/** Путь 1: бесплатно через OpenRouter — модель с :free и ключ. */
export async function setupOpenRouter(context: vscode.ExtensionContext) {
  const model = await vscode.window.showInputBox({
    title: vscode.l10n.t('Adviser: OpenRouter model'),
    prompt: vscode.l10n.t(
      'Free models end with :free. The list: openrouter.ai/models (filter by price 0).',
    ),
    placeHolder: vscode.l10n.t('author/model:free'),
    value: config().get<string>('model', ''),
    ignoreFocusOut: true,
    validateInput: (id) => checkOpenRouterModel(id, translate),
  });
  if (model === undefined) {
    return;
  }
  await config().update('provider', 'openai-compatible', USER);
  await config().update('baseUrl', OPENROUTER_URL, USER);
  await config().update('model', model.trim(), USER);
  const getKey = vscode.l10n.t('Get a key at openrouter.ai');
  const answer = await vscode.window.showInformationMessage(
    vscode.l10n.t('Now you need an OpenRouter key. A free key gives up to 50 requests a day.'),
    getKey,
    vscode.l10n.t('I have a key'),
  );
  if (answer === getKey) {
    await vscode.env.openExternal(vscode.Uri.parse('https://openrouter.ai/keys'));
  }
  if (answer) {
    await setApiKey(context);
  }
}

/** Путь 2: локально через Ollama — сервер на этом компьютере, модель из уже скачанных. */
export async function setupOllama() {
  const models = await listModels(OLLAMA_URL);
  if (models === undefined) {
    const download = vscode.l10n.t('Download Ollama');
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'Ollama does not respond at {0}. Install and start it, download a model (for example, ollama pull qwen2.5-coder:7b — it needs about 8 GB of video memory) and try again.',
        OLLAMA_URL,
      ),
      download,
    );
    if (answer === download) {
      await vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
    }
    return;
  }
  if (!models.length) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t(
        'Ollama is running but has no models. Download one: ollama pull qwen2.5-coder:7b (8 GB of video memory) or qwen2.5-coder:14b (16 GB).',
      ),
    );
    return;
  }
  const model = await vscode.window.showQuickPick(models, {
    title: vscode.l10n.t('Adviser: Ollama model'),
    placeHolder: vscode.l10n.t('Which model should review the code'),
  });
  if (!model) {
    return;
  }
  await config().update('provider', 'openai-compatible', USER);
  await config().update('baseUrl', OLLAMA_URL, USER);
  await config().update('model', model, USER);
  vscode.window.setStatusBarMessage(
    vscode.l10n.t('Adviser: {0} reviews on this computer', model),
    6000,
  );
}

/** Путь 3: свой ключ любого OpenAI-совместимого провайдера — адрес, модель, ключ. */
export async function setupOwnKey(context: vscode.ExtensionContext) {
  await config().update('provider', 'openai-compatible', USER);
  await vscode.commands.executeCommand('workbench.action.openSettings', 'adviser.baseUrl');
  await setApiKey(context);
}

function levelText(level: Level): { label: string; detail: string } {
  switch (level) {
    case 'beginner':
      return {
        label: vscode.l10n.t('Beginner'),
        detail: vscode.l10n.t(
          'Logic, edge cases, error handling, names. No architecture or performance.',
        ),
      };
    case 'intermediate':
      return {
        label: vscode.l10n.t('Intermediate'),
        detail: vscode.l10n.t(
          'Plus function structure, duplication and types. No large-scale architecture.',
        ),
      };
    case 'advanced':
      return {
        label: vscode.l10n.t('Advanced'),
        detail: vscode.l10n.t('Everything, including performance and architecture.'),
      };
  }
}

export async function chooseLevel() {
  const current = config().get<string>('level');
  const picked = await vscode.window.showQuickPick(
    LEVELS.map((level) => ({
      ...levelText(level),
      description: level === current ? vscode.l10n.t('current') : undefined,
      level,
    })),
    { title: vscode.l10n.t('Adviser: your level') },
  );
  if (picked) {
    await config().update('level', picked.level, USER);
  }
}

/** Пробный разбор: учебная функция с типовой ошибкой, курсор в ней, сразу разбор. */
export async function tryReview(context: vscode.ExtensionContext) {
  // Комментарии в учебной функции — на языке интерфейса.
  const sample = vscode.env.language.startsWith('ru') ? 'sample.js' : 'sample.en.js';
  const content = await readBundled(context, 'walkthrough', sample);
  const doc = await vscode.workspace.openTextDocument({ language: 'javascript', content });
  const editor = await vscode.window.showTextDocument(doc);
  const line = doc
    .getText()
    .split('\n')
    .findIndex((l) => l.includes('reduce'));
  editor.selection = new vscode.Selection(Math.max(line, 0), 2, Math.max(line, 0), 2);
  // Языковой сервер только что получил файл: без символов разбор возьмёт ±10 строк вместо функции.
  for (let i = 0; i < 10 && !(await documentSymbols(doc.uri)).length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await vscode.commands.executeCommand('adviser.reviewFunction');
}

/** Модели сервера; undefined — сервер не ответил. */
async function listModels(baseUrl: string): Promise<string[] | undefined> {
  try {
    const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
    return response.ok ? parseModelList(await response.json()) : undefined;
  } catch {
    // Сервер не запущен или не отвечает — мастер подскажет, что делать.
    return undefined;
  }
}
