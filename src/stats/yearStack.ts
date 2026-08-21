import type { Flight } from "@/lib/types";
import type { BarRowData } from "@/components/charts/BarsH";
import type { Series } from "@/components/charts/chartTheme";
import { OTHER_KEY, OTHER_COLOR } from "@/lib/palette";

// Per-year vertical stacked bar: one bar per year, split by the top-N stack groups (+ "Other").
//  - mode "sum":    value summed per (year, group) — visits, or flights/distance/time.
//  - mode "unique": distinct `id`s per (year, group) → the bar totals the unique count, and
//                   each group's segment is how many distinct ids fall under it (e.g. unique
//                   airports grouped by their country).
// `entities(f)` returns { id, group } pairs the flight touches: `id` is the unit counted in
// unique mode; `group` is the stack key (in sum mode only `group` matters).
export function yearStack(opts: {
  flights: Flight[];
  entities: (f: Flight) => { id: string; group: string }[];
  value: (f: Flight) => number;
  label: (group: string) => string;
  color: (group: string, i: number) => string;
  mode: "sum" | "unique";
  topN: number;
}): { rows: BarRowData[]; series: Series[] } {
  const { flights, entities, value, label, color, mode, topN } = opts;
  const yearGroupSum = new Map<string, Map<string, number>>(); // year → group → summed value
  const yearGroupSet = new Map<string, Map<string, Set<string>>>(); // year → group → distinct ids
  const total = new Map<string, number>(); // per group, for ranking

  for (const f of flights) {
    const y = f.flight_date.slice(0, 4);
    const v = value(f);
    for (const { id, group } of entities(f)) {
      if (!group) continue;
      if (mode === "unique") {
        const gm = yearGroupSet.get(y) ?? new Map<string, Set<string>>();
        yearGroupSet.set(y, gm);
        const set = gm.get(group) ?? new Set<string>();
        gm.set(group, set);
        set.add(id);
      } else {
        const gm = yearGroupSum.get(y) ?? new Map<string, number>();
        yearGroupSum.set(y, gm);
        gm.set(group, (gm.get(group) ?? 0) + v);
        total.set(group, (total.get(group) ?? 0) + v);
      }
    }
  }
  // rank groups: by summed value (sum) or by total distinct count across years (unique)
  if (mode === "unique") {
    for (const gm of yearGroupSet.values()) for (const [g, set] of gm) total.set(g, (total.get(g) ?? 0) + set.size);
  }
  const top = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([g]) => g);
  const topSet = new Set(top);
  const years = mode === "unique" ? [...yearGroupSet.keys()].sort() : [...yearGroupSum.keys()].sort();

  const rows: BarRowData[] = years.map((y) => {
    const row: BarRowData = { id: y, label: y };
    for (const g of top) row[g] = 0;
    row[OTHER_KEY] = 0;
    if (mode === "unique") {
      for (const [g, set] of yearGroupSet.get(y)!) {
        const key = topSet.has(g) ? g : OTHER_KEY;
        row[key] = (Number(row[key]) || 0) + set.size;
      }
    } else {
      for (const [g, v] of yearGroupSum.get(y)!) {
        const key = topSet.has(g) ? g : OTHER_KEY;
        row[key] = (Number(row[key]) || 0) + Math.round(v);
      }
    }
    return row;
  });

  // Only carry Other when something actually falls outside the top N — otherwise every
  // chart with fewer groups than topN shows a dead legend entry stuck at zero.
  const hasOther = rows.some((r) => Number(r[OTHER_KEY]) !== 0);
  if (!hasOther) for (const r of rows) delete r[OTHER_KEY];

  const series: Series[] = [
    ...top.map((g, i) => ({ key: g, name: label(g), color: color(g, i) })),
    ...(hasOther ? [{ key: OTHER_KEY, name: "Other", color: OTHER_COLOR }] : []),
  ];
  return { rows, series };
}
