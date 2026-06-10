import type { Flight } from "@/lib/types";
import type { BarRowData } from "@/components/charts/BarsH";
import { categoricalFor } from "@/lib/palette";
import { metricValue, type Metric } from "./useMetric";

// Group bars (by city or country) each stacked by their airports. A flight is
// counted once per bar (if both endpoints fall in the same group it's attributed
// to the departure airport). Shared by the Cities and Countries panels.
export function buildAirportStack(flights: Flight[], metric: Metric, mode: "city" | "country") {
  const byGroup = new Map<string, { name: string; airports: Map<string, number> }>();
  const add = (gid: string, name: string, iata: string, v: number) => {
    const g = byGroup.get(gid) ?? { name, airports: new Map<string, number>() };
    g.airports.set(iata, (g.airports.get(iata) ?? 0) + v);
    byGroup.set(gid, g);
  };
  const keyOf = (city: string | null, iata: string, iso: string | null, isoName: string | null) =>
    mode === "country" ? { id: iso ?? "??", name: isoName ?? iso ?? "??" } : { id: city ?? iata, name: city ?? iata };

  for (const f of flights) {
    const v = metricValue(f, metric);
    const d = keyOf(f.dep_city, f.dep_iata, f.dep_country, f.dep_country_name);
    const a = keyOf(f.arr_city, f.arr_iata, f.arr_country, f.arr_country_name);
    add(d.id, d.name, f.dep_iata, v);
    if (a.id !== d.id) add(a.id, a.name, f.arr_iata, v);
  }

  const top = [...byGroup.entries()]
    .map(([id, g]) => ({ id, name: g.name, airports: g.airports, total: [...g.airports.values()].reduce((x, y) => x + y, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
  const apTotals = new Map<string, number>();
  for (const g of top) for (const [iata, v] of g.airports) apTotals.set(iata, (apTotals.get(iata) ?? 0) + v);
  const topAirports = [...apTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([iata]) => iata);

  const series = [
    ...topAirports.map((iata, i) => ({ key: iata, name: iata, color: categoricalFor(iata, i) })),
    { key: "__other", name: "Other", color: "#5C6575" },
  ];
  const rows: BarRowData[] = top.map((g) => {
    const row: BarRowData = { id: g.id, label: g.name };
    let other = 0;
    for (const [iata, v] of g.airports) {
      if (topAirports.includes(iata)) row[iata] = Math.round(v);
      else other += v;
    }
    row.__other = Math.round(other);
    return row;
  });
  const names = new Map(top.map((g) => [g.id, g.name]));
  return { rows, series, names };
}
