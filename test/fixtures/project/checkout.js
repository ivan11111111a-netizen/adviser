import { round } from './utils/money.js';
import { first } from './generated/api.js';

export function checkout(items) {
  const total = items.reduce((sum, item) => sum + item.price, 0);
  return round(total) + first(items);
}
