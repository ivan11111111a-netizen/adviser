function maxOf(numbers) {
  if (numbers.length === 0) {
    return undefined;
  }
  let max = numbers[0];
  for (const n of numbers) {
    if (n > max) {
      max = n;
    }
  }
  return max;
}
