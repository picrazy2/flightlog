import { useState } from "react";
import type { StatModule } from "../types";
import type { Flight } from "@/lib/types";
import { uniqueCount, airportsFrom } from "@/lib/aggregate";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { Dropdown } from "@/components/ui/Dropdown";
import { OptionsButton } from "@/components/ui/OptionsButton";
import { BarsH, type BarRowData } from "@/components/charts/BarsH";
import { BarsV } from "@/components/charts/BarsV";
import { useStore } from "@/state/store";
import { airportFilter } from "../filters";
import { color, categoricalFor } from "@/lib/palette";
import { buildYearGroups } from "@/lib/yearGroups";
import { visitClassByAirport } from "../entityBreakdown";
import { yearStack } from "../yearStack";

const TOP = 8;
const CONNECTION_MS = 16 * 60 * 60 * 1000;

const CONTINENTS: { code: string; name: string }[] = [
  { code: "NA", name: "N. America" },
  { code: "EU", name: "Europe" },
  { code: "AS", name: "Asia" },
  { code: "SA", name: "S. America" },
  { code: "OC", name: "Oceania" },
  { code: "AF", name: "Africa" },
  { code: "AN", name: "Antarctica" },
];
const CONT_NAME: Record<string, string> = Object.fromEntries(CONTINENTS.map((c) => [c.code, c.name]));

// Group consecutive years when there are many of them (>10 → pairs, >20 → triples…).
// Per-airport, per-year connection-deduped visits (visits = dep + arr − connections).
function visitsByAirportYear(flights: Flight[]) {
  const m = new Map<string, Map<string, number>>(); // iata → year → visits
  const bump = (iata: string, year: string, d: number) => {
    const ym = m.get(iata) ?? new Map<string, number>();
    ym.set(year, (ym.get(year) ?? 0) + d);
    m.set(iata, ym);
  };
  for (const f of flights) {
    const y = f.flight_date.slice(0, 4);
    bump(f.dep_iata, y, 1);
    bump(f.arr_iata, y, 1);
  }
  const chrono = [...flights].sort((a, b) => a.sched_dep.localeCompare(b.sched_dep));
  for (let i = 0; i < chrono.length - 1; i++) {
    const cur = chrono[i];
    const next = chrono[i + 1];
    if (cur.arr_iata !== next.dep_iata) continue;
    const gap = new Date(next.sched_dep).getTime() - new Date(cur.sched_arr).getTime();
    if (gap >= 0 && gap <= CONNECTION_MS) bump(cur.arr_iata, cur.flight_date.slice(0, 4), -1);
  }
  return m;
}

export const airports: StatModule = {
  id: "airports",
  order: 2,
  card: (ctx) => {
    const n = ctx.airports.size;
    const prev = ctx.compareFlights
      ? uniqueCount(ctx.compareFlights.flatMap((f) => [f.dep_iata, f.arr_iata]), (x) => x)
      : 0;
    return {
      eyebrow: "Airports",
      headline: `${n.toLocaleString()} Airports`,
      stats: [{ value: n, unit: "airports", compareValue: ctx.compareFlights ? prev : null }],
    };
  },
  Panel: ({ ctx }) => {
    const [metric, setMetric] = useState<"visits" | "destinations">("visits");
    const [vBreak, setVBreak] = useState<"type" | "domintl" | "year">("type");
    const [dBreak, setDBreak] = useState<"domintl" | "country" | "continent">("domintl");
    const [percent, setPercent] = useState(false);
    const { toggleCrossFilter, crossFilters } = useStore();
    // airport charts exclude the airport facet so selecting airports doesn't hide the rest
    const airportFlights = ctx.flights;
    const aggs = [...airportsFrom(airportFlights).values()];
    const airportActive = crossFilters.filter((c) => c.id.startsWith("airport:")).map((c) => c.id.slice("airport:".length));

    // build the first chart's rows + series from the metric + breakdown
    let rows: BarRowData[] = [];
    let series: { key: string; name: string; color: string }[] = [];
    const unit = metric === "destinations" ? "destinations" : "visits";

    if (metric === "visits" && vBreak === "type") {
      series = [
        { key: "departures", name: "Departures", color: color.accent },
        { key: "arrivals", name: "Arrivals", color: color.secondary },
        { key: "connections", name: "Connections", color: "#A78BFA" },
      ];
      rows = aggs
        .map((a) => ({ id: a.iata, label: a.iata, departures: a.departures - a.connections, arrivals: a.arrivals - a.connections, connections: a.connections }))
        .sort((a, b) => b.departures + b.arrivals + b.connections - (a.departures + a.arrivals + a.connections));
    } else if (metric === "visits" && vBreak === "domintl") {
      series = [
        { key: "domestic", name: "Domestic", color: color.accent },
        { key: "international", name: "International", color: color.secondary },
      ];
      rows = [...visitClassByAirport(airportFlights).entries()]
        .map(([iata, x]) => ({ id: iata, label: iata, domestic: x.dom, international: x.intl }))
        .sort((a, b) => b.domestic + b.international - (a.domestic + a.international));
    } else if (metric === "visits") {
      // year(-group) visits
      const allYears = [...new Set(airportFlights.map((f) => f.flight_date.slice(0, 4)))].sort();
      const { groups } = buildYearGroups(allYears);
      series = groups.map((g, i) => ({ key: g.key, name: g.label, color: categoricalFor(g.key, i) }));
      const vby = visitsByAirportYear(airportFlights);
      rows = [...vby.entries()]
        .map(([iata, ym]) => {
          const row: BarRowData = { id: iata, label: iata };
          let total = 0;
          for (const g of groups) {
            const v = g.members.reduce((s, y) => s + (ym.get(y) ?? 0), 0);
            row[g.key] = v;
            total += v;
          }
          row.__total = total;
          return row;
        })
        .sort((a, b) => Number(b.__total) - Number(a.__total));
    } else {
      // DESTINATIONS: per airport, the distinct other airports it connects to, stacked by
      // the destination's dom/intl (relative to the home airport), country, or continent.
      const homeCountry = new Map<string, string | null>();
      const dests = new Map<string, Map<string, { country: string | null; countryName: string | null; continent: string | null }>>();
      const add = (a: string, b: string, info: { country: string | null; countryName: string | null; continent: string | null }) => {
        const m = dests.get(a) ?? new Map();
        if (!m.has(b)) m.set(b, info);
        dests.set(a, m);
      };
      for (const f of airportFlights) {
        homeCountry.set(f.dep_iata, f.dep_country ?? null);
        homeCountry.set(f.arr_iata, f.arr_country ?? null);
        add(f.dep_iata, f.arr_iata, { country: f.arr_country ?? null, countryName: f.arr_country_name ?? null, continent: f.arr_continent ?? null });
        add(f.arr_iata, f.dep_iata, { country: f.dep_country ?? null, countryName: f.dep_country_name ?? null, continent: f.dep_continent ?? null });
      }
      const bucket = (home: string, info: { country: string | null; countryName: string | null; continent: string | null }) =>
        dBreak === "domintl"
          ? info.country && info.country === homeCountry.get(home) ? "domestic" : "international"
          : dBreak === "country"
          ? info.countryName ?? info.country ?? "—"
          : CONT_NAME[info.continent ?? ""] ?? "—";
      // per-airport bucket counts
      const perAirport = new Map<string, Map<string, number>>();
      const bucketTotal = new Map<string, number>();
      for (const [iata, dm] of dests) {
        const bm = new Map<string, number>();
        for (const info of dm.values()) {
          const k = bucket(iata, info);
          bm.set(k, (bm.get(k) ?? 0) + 1);
          bucketTotal.set(k, (bucketTotal.get(k) ?? 0) + 1);
        }
        perAirport.set(iata, bm);
      }
      if (dBreak === "domintl") {
        series = [
          { key: "domestic", name: "Domestic", color: color.accent },
          { key: "international", name: "International", color: color.secondary },
        ];
      } else {
        const top = [...bucketTotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
        series = [...top.map((k, i) => ({ key: k, name: k, color: categoricalFor(k, i) })), { key: "__other", name: "Other", color: "#475569" }];
      }
      const topKeys = new Set(series.map((s) => s.key));
      rows = [...perAirport.entries()]
        .map(([iata, bm]) => {
          const row: BarRowData = { id: iata, label: iata };
          let total = 0;
          for (const s of series) row[s.key] = 0;
          for (const [k, n] of bm) {
            const key = topKeys.has(k) ? k : "__other";
            row[key] = (Number(row[key]) || 0) + n;
            total += n;
          }
          row.__total = total;
          return row;
        })
        .sort((a, b) => Number(b.__total) - Number(a.__total));
    }

    // second chart: per-year, by top airport (visits = sum; destinations = unique airports/yr)
    // destinations (unique airports) stacks by the airport's country; visits stacks by airport
    const uniqueYear = metric === "destinations";
    const yc = yearStack({
      flights: airportFlights,
      entities: (f) => [
        { id: f.dep_iata, group: uniqueYear ? f.dep_country_name ?? f.dep_country ?? "—" : f.dep_iata },
        { id: f.arr_iata, group: uniqueYear ? f.arr_country_name ?? f.arr_country ?? "—" : f.arr_iata },
      ],
      value: () => 1,
      label: (g) => g,
      color: (g, i) => categoricalFor(g, i),
      mode: uniqueYear ? "unique" : "sum",
      topN: 8,
    });

    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            aria-label="Metric"
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "visits", label: "Visits" },
              { value: "destinations", label: "Destinations" },
            ]}
          />
          <div className="flex items-center gap-2">
            {metric === "visits" ? (
              <Dropdown
                aria-label="Breakdown"
                size="sm"
                value={vBreak}
                onChange={setVBreak}
                options={[
                  { value: "type", label: "Visit type" },
                  { value: "domintl", label: "Dom·Intl" },
                  { value: "year", label: "Year" },
                ]}
              />
            ) : (
              <Dropdown
                aria-label="Breakdown"
                size="sm"
                value={dBreak}
                onChange={setDBreak}
                options={[
                  { value: "domintl", label: "Dom·Intl" },
                  { value: "country", label: "Countries" },
                  { value: "continent", label: "Continents" },
                ]}
              />
            )}
            <OptionsButton>
              <div className="flex items-center justify-between">
                <span className="text-label text-ink-muted">100% stacked</span>
                <Switch checked={percent} onChange={setPercent} />
              </div>
            </OptionsButton>
          </div>
        </div>
        <div className="text-eyebrow tracking-[0.01em] text-ink-faint">
          {metric === "visits" ? "Most-visited airports" : "Airports by distinct destinations reached"}
        </div>
        <BarsH rows={rows} percent={percent} series={series} activeId={airportActive} unit={unit} cap={TOP} onPick={(id) => toggleCrossFilter(airportFilter(id))} />

        {yc.rows.length > 1 && (
          <>
            <div className="text-eyebrow tracking-[0.01em] text-ink-faint">
              {metric === "destinations" ? "Unique airports" : "Visits"} per year, by top airport
            </div>
            <BarsV rows={yc.rows} series={yc.series} unit={metric === "destinations" ? "airports" : "visits"} />
          </>
        )}
      </>
    );
  },
  // No custom map encoding: airports are already √-sized by visits by default, so the
  // map + legend behave like the default view (domestic/intl routes + airport toggle).
};
