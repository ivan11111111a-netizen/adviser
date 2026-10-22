// Adviser trial review: this function has a typical mistake.
// Hover over the underline to see a hint question. Think it over, then press "Explain".

function averagePrice(items) {
  const total = items.reduce((sum, item) => sum + item.price);
  return total / items.length;
}
