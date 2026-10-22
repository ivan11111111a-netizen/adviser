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
export function consentDetail(destination: Destination): string {
  const lines = [
    `Куда: ${consentKey(destination)}, модель ${destination.model}.`,
    '',
    'Что уходит: код разбираемой функции и её окружение — что нашли линтер и компилятор, первые строки соседних функций, версии зависимостей, правила стиля проекта.',
    '',
    'Что не уходит: файлы .env*, всё из .adviserignore и ignore в .adviser/config.json. Ключи и пароли в коде заменяются меткой до отправки. Журнал ошибок остаётся на этом компьютере, телеметрии нет.',
  ];
  if (isFreeTier(destination)) {
    lines.push(
      '',
      'Бесплатные модели: провайдер может использовать запросы для обучения своих моделей. Для учебных проектов это обычно приемлемо, для рабочего кода — нет.',
    );
  }
  return lines.join('\n');
}
