function f(a, b) {
  let c = 0;
  for (const d of a) {
    if (d.t === b) {
      c++;
    }
  }
  return c;
}
