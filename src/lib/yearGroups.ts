// Bucket a list of years into at most 4 contiguous classes (~equal spans, e.g.
// 12 years → 3 per class; 10 years → 3/3/3/1). Shared by the airports-by-year
// chart and the map's year colour mode so both classify identically.
export const YEAR_CLASSES = 4;
export function buildYearGroups(years: string[]) {
  const sorted = [...years].sort();
  const size = Math.max(1, Math.ceil(sorted.length / YEAR_CLASSES));
  const groups: { key: string; label: string; members: string[] }[] = [];
  for (let i = 0; i < sorted.length; i += size) {
    const chunk = sorted.slice(i, i + size);
    const label = chunk.length === 1 ? chunk[0] : `${chunk[0]}–${chunk[chunk.length - 1].slice(2)}`;
    groups.push({ key: chunk[0], label, members: chunk });
  }
  const keyOf = new Map<string, string>();
  for (const g of groups) for (const y of g.members) keyOf.set(y, g.key);
  return { groups, keyOf };
}
