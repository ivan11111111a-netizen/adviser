function averagePrice(items) {
  const total = items.reduce((sum, item) => sum + item.price);
  return total / items.length;
}
