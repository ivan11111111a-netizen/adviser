// Пробный разбор Adviser: в этой функции есть типовая ошибка.
// Наведи мышь на подчёркивание — там вопрос-намёк. Подумай, потом жми «Объяснить».

function averagePrice(items) {
  const total = items.reduce((sum, item) => sum + item.price);
  return total / items.length;
}
