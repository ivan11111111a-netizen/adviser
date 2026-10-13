function groupByCategory(items: { category: string; name: string }[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const names = groups.get(item.category) ?? [];
    names.push(item.name);
    groups.set(item.category, names);
  }
  return groups;
}
