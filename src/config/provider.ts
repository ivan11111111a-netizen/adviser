import * as vscode from 'vscode';
import { isLocal, type Destination } from '../core/consent';
import { OLLAMA_URL } from '../core/setup';
import type { Provider } from '../core/engine';
import { createClaudeCodeProvider, resolveClaudeExecutable } from '../providers/claudeCode';
import { createCopilotProvider } from '../providers/copilot';
import { mockProvider } from '../providers/mock';
import { createOpenAICompatibleProvider } from '../providers/openaiCompatible';

export const API_KEY_SECRET = 'adviser.apiKey';

export interface ConfiguredProvider {
  provider: Provider;
  /** Провайдер, адрес и модель: часть ключа кэша. */
  id: string;
  /** Куда уходит код — для окна согласия. У провайдеров разработки его нет. */
  destination?: Destination;
}

/**
 * Собирает провайдер по настройкам. Провайдер, адрес и модель объявлены со scope "machine":
 * VS Code не берёт их из настроек репозитория, иначе чужой проект мог бы увести код и ключ.
 * Возвращает строку, если собрать нельзя, — её показываем пользователю.
 */
export async function createProvider(
  context: vscode.ExtensionContext,
): Promise<ConfiguredProvider | string> {
  const config = vscode.workspace.getConfiguration('adviser');
  const kind = config.get<string>('provider', 'openai-compatible');
  const model = config.get<string>('model', '').trim();
  const fromSources = context.extensionMode !== vscode.ExtensionMode.Production;

  switch (kind) {
    case 'openai-compatible': {
      if (!model) {
        return 'укажи модель в настройке adviser.model';
      }
      const baseURL = config.get<string>('baseUrl', 'https://openrouter.ai/api/v1');
      return {
        id: `${kind} ${baseURL} ${model}`,
        destination: { baseUrl: baseURL, model },
        provider: createOpenAICompatibleProvider({
          baseURL,
          apiKey: await context.secrets.get(API_KEY_SECRET),
          model,
        }),
      };
    }
    case 'copilot': {
      const copilot = await createCopilotProvider(model || undefined);
      if (typeof copilot === 'string') {
        return copilot;
      }
      return {
        id: `${kind} ${copilot.model}`,
        // Код уходит в GitHub Copilot: окно согласия скажет это так же, как про любой сервер.
        destination: { baseUrl: 'GitHub Copilot', model: copilot.model },
        provider: copilot.provider,
      };
    }
    case 'claude-code':
      // Подписку Claude можно использовать только как разработчик: правила Anthropic.
      if (!fromSources) {
        return 'провайдер claude-code работает только при запуске из исходников (F5)';
      }
      return {
        id: `${kind} ${model || 'sonnet'}`,
        provider: createClaudeCodeProvider({
          executable: resolveClaudeExecutable(config.get<string>('dev.claudePath', 'claude')),
          model: model || 'sonnet',
        }),
      };
    case 'mock':
      if (!fromSources) {
        return 'провайдер mock работает только при запуске из исходников и в тестах';
      }
      return { id: kind, provider: mockProvider };
    default:
      return `неизвестный провайдер «${kind}» в adviser.provider`;
  }
}

/**
 * Запасная модель на случай исчерпанного бюджета (6.9 плана). Только сервер на этом компьютере:
 * он бесплатный, и код не уходит в сеть. undefined — запасной нет, разборы встают на паузу.
 */
export function createFallbackProvider(): ConfiguredProvider | undefined {
  const config = vscode.workspace.getConfiguration('adviser.budget');
  const model = config.get<string>('fallbackModel', '').trim();
  const baseURL = config.get<string>('fallbackBaseUrl', OLLAMA_URL);
  if (!model || !isLocal(baseURL)) {
    return undefined;
  }
  return {
    id: `fallback ${baseURL} ${model}`,
    destination: { baseUrl: baseURL, model },
    provider: createOpenAICompatibleProvider({ baseURL, model }),
  };
}

export async function setApiKey(context: vscode.ExtensionContext) {
  const key = await vscode.window.showInputBox({
    title: 'Adviser: API-ключ',
    prompt: 'Хранится в SecretStorage VS Code. Пустое значение удаляет ключ.',
    password: true,
    ignoreFocusOut: true,
  });
  if (key === undefined) {
    return;
  }
  if (key.trim()) {
    await context.secrets.store(API_KEY_SECRET, key.trim());
  } else {
    await context.secrets.delete(API_KEY_SECRET);
  }
  vscode.window.setStatusBarMessage(
    key.trim() ? 'Adviser: ключ сохранён' : 'Adviser: ключ удалён',
    4000,
  );
}
