function totalFromInputs(inputs) {
  let total = 0;
  for (const input of inputs) {
    total = total + input.value;
  }
  return total;
}
