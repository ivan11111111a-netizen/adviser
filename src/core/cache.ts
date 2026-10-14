import { createHash } from 'node:crypto';

/**
 * Ключ кэша разборов: всё, от чего зависит ответ, — провайдер с моделью, весь текст промпта
 * (его версия, уровень, язык, типы ошибок) и код. Изменилось что угодно — другой ключ.
 */
export function cacheKey(...parts: string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part).update('\0');
  }
  return hash.digest('hex');
}

/** Кэш на max записей: при переполнении уходит та, к которой дольше всех не обращались. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value!);
    }
  }
}
