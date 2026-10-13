function cheapestThree(prices) {
  const sorted = prices.sort();
  return sorted.slice(0, 3);
}
