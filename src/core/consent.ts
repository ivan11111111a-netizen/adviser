import { untranslated, type Translate } from './i18n';

/** Куда уходит код: провайдер, адрес сервера и модель (6.10 плана). */
export interface Destination {
  baseUrl: string;
  model: string;
}

/** Код не покидает машину: Ollama, LM Studio и другие серверы на этом компьютере. */
export function isLocal(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return false;
  }
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/** Согласие даётся на сервер: смена модели у того же провайдера заново не спрашивает. */
export function consentKey(destination: Destination): string {
  try {
    return new URL(destination.baseUrl).origin;
  } catch {
    return destination.baseUrl;
  }
}

/** Бесплатные модели OpenRouter: провайдер может учиться на запросах (6.9 плана). */
export function isFreeTier(destination: Destination): boolean {
  return destination.model.endsWith(':free');
}

/** Текст окна согласия: куда, что уходит, что не уходит, и про бесплатные модели. */
export function consentDetail(destination: Destination, t: Translate = untranslated): string {
  const lines = [
    t('Where: {0}, model {1}.', consentKey(destination), destination.model),
    '',
    t(
      "What is sent: the code of the function being reviewed and its surroundings — what the linter and compiler found, the first lines of nearby functions, dependency versions, the project's style rules.",
    ),
    '',
    t(
      'What is not sent: .env* files, anything in .adviserignore or in ignore in .adviser/config.json. Keys and passwords in the code are replaced with a placeholder before sending. The mistake journal stays on this computer; there is no telemetry.',
    ),
  ];
  if (isFreeTier(destination)) {
    lines.push(
      '',
      t(
        'Free models: the provider may use requests to train its models. This is usually fine for study projects, but not for work code.',
      ),
    );
  }
  return lines.join('\n');
}
