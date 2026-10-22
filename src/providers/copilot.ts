import * as vscode from 'vscode';
import { InvalidResponseError, type Provider } from '../core/engine';
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
          'no GitHub Copilot models: install the GitHub Copilot extension and sign in to GitHub (they are not available in Cursor)',
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
        } finally {
          cancel.dispose();
        }
        const json = extractJson(text);
        if (json === undefined) {
          throw new InvalidResponseError('Copilot ответил не JSON');
        }
        return json;
      },
    },
  };
}

/** Мастер: путь через GitHub Copilot — выбрать модель из доступных. */
export async function setupCopilot() {
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (!models.length) {
    const install = vscode.l10n.t('Find GitHub Copilot');
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'There are no GitHub Copilot models. Install the GitHub Copilot extension and sign in to GitHub. Students can get Copilot for free through GitHub Education. This path does not work in Cursor.',
      ),
      install,
    );
    if (answer === install) {
      await vscode.commands.executeCommand('workbench.extensions.search', 'GitHub.copilot');
    }
    return;
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
