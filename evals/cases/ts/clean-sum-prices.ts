function sumPrices(items: { price: number }[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
