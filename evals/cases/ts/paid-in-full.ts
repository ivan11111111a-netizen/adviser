function paidInFull(prices: number[], paid: number): boolean {
  const total = prices.reduce((sum, price) => sum + price, 0);
  return total === paid;
}
