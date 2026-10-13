function removeNegatives(numbers) {
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] < 0) {
      numbers.splice(i, 1);
    }
  }
  return numbers;
}
