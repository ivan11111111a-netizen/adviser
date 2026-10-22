/**
 * JSON из текстового ответа модели — для провайдеров без structured outputs (Language Model API).
 * Модель может обернуть ответ в ```json … ``` или добавить фразу до и после: берём объект от первой
 * «{» до последней «}». undefined — JSON не нашёлся.
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    // Не JSON — движок сделает повтор, как с любым ответом не по схеме.
    return undefined;
  }
}
