function countWords(text) {
  const words = text.split(' ');
  const counts = {};
  for (const word of words) {
    counts[word] = counts[word] + 1;
  }
  return counts;
}
