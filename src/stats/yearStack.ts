import type { Flight } from "@/lib/types";
import type { BarRowData } from "@/components/charts/BarsH";
import type { Series } from "@/components/charts/chartTheme";

const OTHER_KEY = "__other";
const OTHER_COLOR = "#475569";

// Per-year vertical stacked bar: one bar per year, split by the top-N entities (+ "Other").
//  - mode "sum":    value summed per (year, entity) — visits, or flights/distance/time.
//  - mode "unique": 1 per distinct entity present that year → the bar totals the unique count.
// `entities(f)` returns the id(s) a flight touches (e.g. its dep + arr airport).
export function yearStack(opts: {
  flights: Flight[];
  entities: (f: Flight) => (string | null | undefined)[];
  value: (f: Flight) => number;
  label: (id: string) => string;
  color: (id: string, i: number) => string;
  mode: "sum" | "unique";
  topN: number;
}): { rows: BarRowData[]; series: Series[] } {
  const { flights, entities, value, label, color, mode, topN } = opts;
  const byYearSum = new Map<string, Map<string, number>>();
  const byYearSet = new Map<string, Set<string>>();
  const total = new Map<string, number>(); // for ranking the top entities

  for (const f of flights) {
    const y = f.flight_date.slice(0, 4);
    const v = value(f);
    const sums = byYearSum.get(y) ?? new Map<string, number>();
    byYearSum.set(y, sums);
    const set = byYearSet.get(y) ?? new Set<string>();
    byYearSet.set(y, set);
    for (const raw of entities(f)) {
      if (!raw) continue;
      sums.set(raw, (sums.get(raw) ?? 0) + v);
      set.add(raw);
      total.set(raw, (total.get(raw) ?? 0) + v);
    }
  }

  const top = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([e]) => e);
  const topSet = new Set(top);
  const years = [...byYearSum.keys()].sort();

  const rows: BarRowData[] = years.map((y) => {
    const row: BarRowData = { id: y, label: y };
    if (mode === "unique") {
      const set = byYearSet.get(y)!;
      for (const e of top) row[e] = set.has(e) ? 1 : 0;
      let other = 0;
      for (const e of set) if (!topSet.has(e)) other++;
      row[OTHER_KEY] = other;
    } else {
      const sums = byYearSum.get(y)!;
      for (const e of top) row[e] = Math.round(sums.get(e) ?? 0);
      let other = 0;
      for (const [e, v] of sums) if (!topSet.has(e)) other += v;
      row[OTHER_KEY] = Math.round(other);
    }
    return row;
  });

  const series: Series[] = [
    ...top.map((e, i) => ({ key: e, name: label(e), color: color(e, i) })),
    { key: OTHER_KEY, name: "Other", color: OTHER_COLOR },
  ];
  return { rows, series };
}
