import * as vscode from 'vscode';
import { InvalidResponseError, ProviderRefusal, type Provider } from '../core/engine';
import { extractJson } from '../core/jsonText';

/**
 * Модели GitHub Copilot через Language Model API VS Code: ключ не нужен, нужен Copilot
 * (у студентов бывает бесплатным через GitHub Education). В Cursor этот API моделей не отдаёт.
 * Structured outputs здесь нет, поэтому схема ответа идёт текстом, а JSON достаётся из ответа.
 */
export async function createCopilotProvider(
  family: string | undefined,
): Promise<{ provider: Provider; model: string } | string> {
  const models = await vscode.lm.selectChatModels({
    vendor: 'copilot',
    ...(family ? { family } : {}),
  });
  const model = models[0];
  if (!model) {
    return family
      ? vscode.l10n.t('Copilot has no "{0}" model: clear adviser.model or pick another one', family)
      : vscode.l10n.t(
          'no GitHub Copilot models: sign in to GitHub in VS Code ("Adviser: Connect a Model: via GitHub Copilot"); they are not available in Cursor',
        );
  }
  return {
    model: model.family,
    provider: {
      async complete(request, signal) {
        const cancel = new vscode.CancellationTokenSource();
        signal?.addEventListener('abort', () => cancel.cancel());
        const messages = [
          vscode.LanguageModelChatMessage.User(
            `${request.system}\n\nОтветь только JSON-объектом по этой JSON-схеме, без пояснений и без Markdown:\n${JSON.stringify(request.jsonSchema)}`,
          ),
          vscode.LanguageModelChatMessage.User(request.prompt),
        ];
        let text = '';
        try {
          const response = await model.sendRequest(
            messages,
            { justification: vscode.l10n.t('Adviser reviews the function you changed') },
            cancel.token,
          );
          for await (const part of response.text) {
            text += part;
          }
        } catch (e) {
          throw refusal(e) ?? e;
        } finally {
          cancel.dispose();
        }
        const json = extractJson(text);
        if (json === undefined) {
          throw new InvalidResponseError('Copilot did not answer with JSON');
        }
        return json;
      },
    },
  };
}

/**
 * Отказы Copilot, которые повтором не лечатся. Исчерпанный лимит Copilot отдаёт как
 * LanguageModelError с name ChatQuotaExceeded (встроенное расширение Copilot Chat 0.71).
 * Временную блокировку за частые запросы (Blocked) оставляем повтору с паузой.
 */
function refusal(e: unknown): ProviderRefusal | undefined {
  if (!(e instanceof vscode.LanguageModelError)) {
    return undefined;
  }
  if (e.code === 'NoPermissions') {
    return new ProviderRefusal(
      vscode.l10n.t(
        'VS Code does not let Adviser use Copilot models: allow it in the Accounts menu → Manage Language Model Access',
      ),
      { cause: e },
    );
  }
  if (e.name === 'ChatQuotaExceeded') {
    return new ProviderRefusal(
      vscode.l10n.t('the GitHub Copilot limit is used up: reviews will resume when it renews'),
      { cause: e },
    );
  }
  if (e.code === 'NotFound') {
    return new ProviderRefusal(
      vscode.l10n.t(
        'the Copilot model is no longer available: pick another one ("Adviser: Connect a Model: via GitHub Copilot")',
      ),
      { cause: e },
    );
  }
  return undefined;
}

/** Мастер: путь через GitHub Copilot — выбрать модель из доступных. */
export async function setupCopilot(): Promise<void> {
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (!models.length) {
    return noModels();
  }
  const families = [...new Set(models.map((m) => m.family))];
  const picked = await vscode.window.showQuickPick(
    families.map((family) => ({
      label: family,
      description: models.find((m) => m.family === family)?.name,
    })),
    {
      title: vscode.l10n.t('Adviser: Copilot model'),
      placeHolder: vscode.l10n.t('Which model should review the code'),
    },
  );
  if (!picked) {
    return;
  }
  const config = vscode.workspace.getConfiguration('adviser');
  await config.update('provider', 'copilot', vscode.ConfigurationTarget.Global);
  await config.update('model', picked.label, vscode.ConfigurationTarget.Global);
  vscode.window.setStatusBarMessage(
    vscode.l10n.t('Adviser: {0} reviews through Copilot', picked.label),
    6000,
  );
}

/** Команды входа в Copilot, встроенного в VS Code, — от точной к общей. */
const SIGN_IN_COMMANDS = [
  'workbench.action.chat.triggerSetupForceSignIn',
  'workbench.action.chat.triggerSetup',
];

/** Сколько ждать, пока человек войдёт в GitHub, чтобы сразу предложить выбрать модель. */
const SIGN_IN_WAIT_MS = 5 * 60_000;

/**
 * Моделей Copilot нет. В свежем VS Code Copilot встроен и ждёт только входа в GitHub; если ИИ
 * в VS Code выключен (chat.disableAIFeatures), моделей не будет и после входа. В Cursor и старых
 * версиях входа через VS Code нет — остаётся страница расширения.
 */
async function noModels() {
  const plan = vscode.l10n.t(
    'Students can get Copilot for free through GitHub Education; the free Copilot plan has a small monthly limit.',
  );
  if (vscode.workspace.getConfiguration('chat').get<boolean>('disableAIFeatures')) {
    const open = vscode.l10n.t('Open the setting');
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'AI features are turned off in VS Code (chat.disableAIFeatures), so there are no Copilot models.',
      ),
      open,
    );
    if (answer === open) {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'chat.disableAIFeatures',
      );
    }
    return;
  }
  const available = await vscode.commands.getCommands(true);
  const signIn = SIGN_IN_COMMANDS.find((id) => available.includes(id));
  if (signIn) {
    const action = vscode.l10n.t('Sign in to GitHub');
    const answer = await vscode.window.showWarningMessage(
      `${vscode.l10n.t('There are no GitHub Copilot models yet: sign in to GitHub in VS Code.')} ${plan}`,
      action,
    );
    if (answer === action) {
      // Модели появятся после входа — тогда сразу предлагаем выбрать.
      const appeared = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          listener.dispose();
          resolve(false);
        }, SIGN_IN_WAIT_MS);
        const listener = vscode.lm.onDidChangeChatModels(async () => {
          if ((await vscode.lm.selectChatModels({ vendor: 'copilot' })).length) {
            clearTimeout(timer);
            listener.dispose();
            resolve(true);
          }
        });
      });
      await vscode.commands.executeCommand(signIn);
      if (await appeared) {
        await setupCopilot();
      }
    }
    return;
  }
  const install = vscode.l10n.t('Find GitHub Copilot');
  const answer = await vscode.window.showWarningMessage(
    `${vscode.l10n.t('There are no GitHub Copilot models. Install the GitHub Copilot extension and sign in to GitHub. This path does not work in Cursor.')} ${plan}`,
    install,
  );
  if (answer === install) {
    await vscode.commands.executeCommand('workbench.extensions.search', 'GitHub.copilot');
  }
}
