function applyDiscount(price, percent) {
  console.log('price', price, 'percent', percent);
  const discount = (price * percent) / 100;
  console.log('discount', discount);
  return price - discount;
}
