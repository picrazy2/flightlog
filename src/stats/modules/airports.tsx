import { useState } from "react";
import type { StatModule } from "../types";
import type { Flight } from "@/lib/types";
import { uniqueCount, airportsFrom } from "@/lib/aggregate";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { OptionsButton } from "@/components/ui/OptionsButton";
import { BarsH, type BarRowData } from "@/components/charts/BarsH";
import { useStore, ALL_TIME } from "@/state/store";
import { airportFilter, spanRange, rangeMatchesSpan } from "../filters";
import { color, categoricalFor } from "@/lib/palette";
import { buildYearGroups } from "@/lib/yearGroups";
import { visitClassByAirport } from "../entityBreakdown";

type View = "type" | "domintl" | "year";
const TOP = 12;
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
    const [view, setView] = useState<View>("type");
    const [percent, setPercent] = useState(false);
    const [yearByYear, setYearByYear] = useState(false); // year view: flip to one bar per year
    const { toggleCrossFilter, crossFilters, range, setRange } = useStore();
    // airport charts exclude the airport facet so selecting airports doesn't hide the rest
    const airportFlights = ctx.facetFlights("airport");
    const airports = [...airportsFrom(airportFlights).values()];
    const airportActive = crossFilters.filter((c) => c.id.startsWith("airport:")).map((c) => c.id.slice("airport:".length));

    const groupControl = (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          aria-label="Breakdown"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "type", label: "Visit type" },
            { value: "domintl", label: "Dom·Intl" },
            { value: "year", label: "Year" },
          ]}
        />
        <OptionsButton>
          <div className="flex items-center justify-between">
            <span className="text-label text-ink-muted">100% stacked</span>
            <Switch checked={percent} onChange={setPercent} />
          </div>
          {view === "year" && (
            <div className="flex items-center justify-between">
              <span className="text-label text-ink-muted">One bar per year</span>
              <Switch checked={yearByYear} onChange={setYearByYear} />
            </div>
          )}
        </OptionsButton>
      </div>
    );

    // Visit type → one airport per bar, stacked departures / arrivals / connections.
    if (view === "type") {
      const rows: BarRowData[] = airports
        .map((a) => ({
          id: a.iata,
          label: a.iata,
          departures: a.departures - a.connections,
          arrivals: a.arrivals - a.connections,
          connections: a.connections,
        }))
        .sort((a, b) => b.departures + b.arrivals + b.connections - (a.departures + a.arrivals + a.connections));
      return (
        <>
          {groupControl}
          <BarsH
            rows={rows}
            percent={percent}
            activeId={airportActive}
            unit="visits"
            cap={TOP}
            series={[
              { key: "departures", name: "Departures", color: color.accent },
              { key: "arrivals", name: "Arrivals", color: color.secondary },
              { key: "connections", name: "Connections", color: "#A78BFA" },
            ]}
            onPick={(id) => toggleCrossFilter(airportFilter(id))}
          />
        </>
      );
    }

    // Dom·Intl → one airport per bar, stacked domestic / international (connection-aware).
    if (view === "domintl") {
      const byAirport = visitClassByAirport(airportFlights);
      const rows: BarRowData[] = [...byAirport.entries()]
        .map(([iata, x]) => ({ id: iata, label: iata, domestic: x.dom, international: x.intl }))
        .sort((a, b) => b.domestic + b.international - (a.domestic + a.international));
      return (
        <>
          {groupControl}
          <BarsH
            rows={rows}
            percent={percent}
            activeId={airportActive}
            unit="visits"
            cap={TOP}
            series={[
              { key: "domestic", name: "Domestic", color: color.accent },
              { key: "international", name: "International", color: color.secondary },
            ]}
            onPick={(id) => toggleCrossFilter(airportFilter(id))}
          />
        </>
      );
    }

    // Year views bucket consecutive years when there are many of them.
    const allYears = [...new Set(ctx.flights.map((f) => f.flight_date.slice(0, 4)))].sort();
    const { groups } = buildYearGroups(allYears);

    // Year flipped → one bar per INDIVIDUAL year (no bucketing), stacked by continent
    // (unique airports). The default chart below keeps the grouped-year view.
    if (yearByYear) {
      const contOf = new Map<string, string>();
      for (const f of ctx.flights) {
        contOf.set(f.dep_iata, f.dep_continent ?? "??");
        contOf.set(f.arr_iata, f.arr_continent ?? "??");
      }
      const perYear = new Map<string, Map<string, Set<string>>>(); // year → continent → airports
      for (const f of ctx.flights) {
        const y = f.flight_date.slice(0, 4);
        const ym = perYear.get(y) ?? new Map<string, Set<string>>();
        for (const iata of [f.dep_iata, f.arr_iata]) {
          const c = contOf.get(iata) ?? "??";
          const set = ym.get(c) ?? new Set<string>();
          set.add(iata);
          ym.set(c, set);
        }
        perYear.set(y, ym);
      }
      const present = CONTINENTS.filter((c) => [...perYear.values()].some((ym) => (ym.get(c.code)?.size ?? 0) > 0));
      const series = present.map((c, i) => ({ key: c.code, name: c.name, color: categoricalFor(c.code, i) }));
      const rows: BarRowData[] = allYears.map((y) => {
        const ym = perYear.get(y);
        const row: BarRowData = { id: y, label: y };
        for (const c of present) row[c.code] = ym?.get(c.code)?.size ?? 0;
        return row;
      });
      const yearActive = allYears.find((y) => rangeMatchesSpan(range, y, y)) ?? null;
      const toggleSingleYear = (y: string) => setRange(rangeMatchesSpan(range, y, y) ? ALL_TIME : spanRange(y, y, y));
      return (
        <BarsH
          rows={rows}
          percent={percent}
          series={series}
          activeId={yearActive}
          unit="airports"
          onPick={(id) => toggleSingleYear(id)}
        />
      );
    }

    // Year (default) → one airport per bar, stacked by year(-group) visits.
    const vby = visitsByAirportYear(airportFlights);
    const series = groups.map((g, i) => ({ key: g.key, name: g.label, color: categoricalFor(g.key, i) }));
    const rows: BarRowData[] = [...vby.entries()]
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
    return (
      <>
        {groupControl}
        <BarsH rows={rows} percent={percent} series={series} activeId={airportActive} unit="visits" cap={TOP} onPick={(id) => toggleCrossFilter(airportFilter(id))} />
      </>
    );
  },
  // No custom map encoding: airports are already √-sized by visits by default, so the
  // map + legend behave like the default view (domestic/intl routes + airport toggle).
};
