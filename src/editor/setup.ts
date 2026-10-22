import * as vscode from 'vscode';
import { LEVELS, type Level } from '../core/promptBuilder';
import { checkOpenRouterModel, OLLAMA_URL, OPENROUTER_URL, parseModelList } from '../core/setup';
import { setApiKey } from '../config/provider';
import { readBundled } from './bundled';
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
    title: 'Adviser: модель OpenRouter',
    prompt:
      'Бесплатные модели — с суффиксом :free. Список: openrouter.ai/models (фильтр по цене 0).',
    placeHolder: 'автор/модель:free',
    value: config().get<string>('model', ''),
    ignoreFocusOut: true,
    validateInput: checkOpenRouterModel,
  });
  if (model === undefined) {
    return;
  }
  await config().update('provider', 'openai-compatible', USER);
  await config().update('baseUrl', OPENROUTER_URL, USER);
  await config().update('model', model.trim(), USER);
  const getKey = 'Получить ключ на openrouter.ai';
  const answer = await vscode.window.showInformationMessage(
    'Теперь нужен ключ OpenRouter. Бесплатный ключ даёт до 50 запросов в сутки.',
    getKey,
    'Ключ уже есть',
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
    const download = 'Скачать Ollama';
    const answer = await vscode.window.showWarningMessage(
      `Ollama не отвечает на ${OLLAMA_URL}. Установи и запусти её, скачай модель (например, ollama pull qwen2.5-coder:7b — нужно около 8 ГБ видеопамяти) и повтори.`,
      download,
    );
    if (answer === download) {
      await vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
    }
    return;
  }
  if (!models.length) {
    void vscode.window.showWarningMessage(
      'Ollama работает, но моделей нет. Скачай модель: ollama pull qwen2.5-coder:7b (8 ГБ видеопамяти) или qwen2.5-coder:14b (16 ГБ).',
    );
    return;
  }
  const model = await vscode.window.showQuickPick(models, {
    title: 'Adviser: модель Ollama',
    placeHolder: 'Какой моделью разбирать код',
  });
  if (!model) {
    return;
  }
  await config().update('provider', 'openai-compatible', USER);
  await config().update('baseUrl', OLLAMA_URL, USER);
  await config().update('model', model, USER);
  vscode.window.setStatusBarMessage(`Adviser: разбирает ${model} на этом компьютере`, 6000);
}

/** Путь 3: свой ключ любого OpenAI-совместимого провайдера — адрес, модель, ключ. */
export async function setupOwnKey(context: vscode.ExtensionContext) {
  await config().update('provider', 'openai-compatible', USER);
  await vscode.commands.executeCommand('workbench.action.openSettings', 'adviser.baseUrl');
  await setApiKey(context);
}

const LEVEL_TEXT: Record<Level, { label: string; detail: string }> = {
  beginner: {
    label: 'Новичок',
    detail:
      'Логика, крайние случаи, обработка ошибок, имена. Без архитектуры и производительности.',
  },
  intermediate: {
    label: 'Средний',
    detail: 'Плюс структура функций, дубли и типы. Без крупной архитектуры.',
  },
  advanced: { label: 'Продвинутый', detail: 'Всё, включая производительность и архитектуру.' },
};

export async function chooseLevel() {
  const current = config().get<string>('level');
  const picked = await vscode.window.showQuickPick(
    LEVELS.map((level) => ({
      ...LEVEL_TEXT[level],
      description: level === current ? 'сейчас' : undefined,
      level,
    })),
    { title: 'Adviser: твой уровень' },
  );
  if (picked) {
    await config().update('level', picked.level, USER);
  }
}

/** Пробный разбор: учебная функция с типовой ошибкой, курсор в ней, сразу разбор. */
export async function tryReview(context: vscode.ExtensionContext) {
  const content = await readBundled(context, 'walkthrough', 'sample.js');
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
