import { useState } from "react";
import type { StatModule } from "../types";
import type { Flight } from "@/lib/types";
import { routesFrom } from "@/lib/aggregate";
import { Segmented } from "@/components/ui/Segmented";
import { Dropdown } from "@/components/ui/Dropdown";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PanelFooter } from "@/components/ui/Panel";
import { BarsH, type BarRowData } from "@/components/charts/BarsH";
import { BarsV } from "@/components/charts/BarsV";
import type { Series } from "@/components/charts/chartTheme";
import { useStore } from "@/state/store";
import { routeFilter, distanceBinFilter, timeBinFilter } from "../filters";
import { color, categoricalFor } from "@/lib/palette";
import { routeKeyUndirected } from "@/lib/geo";
import { flightDistanceMi, flightMinutes, compact } from "@/lib/format";

type Metric = "flights" | "distance" | "time";
const OTHER = "#5C6575";
// rankings colouring: international is one colour; domestic is split by country
const INTL_COLOR = "#FFC061";
const DOM_PALETTE = ["#5B9DFF", "#34D399", "#A78BFA", "#22D3EE"];
const metricVal = (f: Flight, m: Metric) => (m === "flights" ? 1 : m === "distance" ? flightDistanceMi(f) : flightMinutes(f));

// Top routes, each bar stacked by airline (top 8 airlines + Other), mirroring the
// cities-by-airport breakdown.
function routesByAirline(flights: Flight[], directed: boolean, metric: Metric): { rows: BarRowData[]; series: Series[] } {
  const byRoute = new Map<string, { label: string; dep: string; arr: string; inner: Map<string, number> }>();
  const nameOf = new Map<string, string>();
  for (const f of flights) {
    const key = directed ? `${f.dep_iata}>${f.arr_iata}` : routeKeyUndirected(f.dep_iata, f.arr_iata);
    const [a, b] = [f.dep_iata, f.arr_iata].slice().sort();
    const label = directed ? `${f.dep_iata} → ${f.arr_iata}` : `${a} · ${b}`;
    const g = byRoute.get(key) ?? { label, dep: f.dep_iata, arr: f.arr_iata, inner: new Map<string, number>() };
    g.inner.set(f.airline_iata, (g.inner.get(f.airline_iata) ?? 0) + metricVal(f, metric));
    byRoute.set(key, g);
    if (f.airline_iata) nameOf.set(f.airline_iata, f.airline_name ?? f.airline_iata);
  }
  const top = [...byRoute.entries()]
    .map(([id, g]) => ({ id, ...g, total: [...g.inner.values()].reduce((x, y) => x + y, 0) }))
    .sort((x, y) => y.total - x.total);
  const airTotals = new Map<string, number>();
  for (const g of top) for (const [k, v] of g.inner) airTotals.set(k, (airTotals.get(k) ?? 0) + v);
  const topAir = [...airTotals.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k]) => k);
  const series: Series[] = [
    ...topAir.map((k, i) => ({ key: k, name: nameOf.get(k) ?? k, color: categoricalFor(k, i) })),
    { key: "__other", name: "Other", color: OTHER },
  ];
  const rows: BarRowData[] = top.map((g) => {
    const row: BarRowData = { id: g.id, label: g.label, dep: g.dep, arr: g.arr };
    let other = 0;
    for (const [k, v] of g.inner) {
      if (topAir.includes(k)) row[k] = Math.round(v);
      else other += v;
    }
    row.__other = Math.round(other);
    return row;
  });
  return { rows, series };
}
const MI_TO_KM = 1.60934;
// fixed histogram bin widths: 1000 mi / 1500 km, and 2 h for time
const DIST_STEP_MI = 1000;
const DIST_STEP_KM = 1500;
const TIME_STEP_MIN = 120;

// fixed-width histogram: count of values per [i*step, (i+1)*step) bin. lo/hi (in the
// binned unit) drive the click-to-filter; the top bin is open-ended (hi = Infinity).
function histogram(values: number[], step: number, label: (lo: number, hi: number) => string) {
  const max = Math.max(0, ...values);
  const n = Math.max(1, Math.floor(max / step) + 1);
  const counts = new Array(n).fill(0);
  for (const v of values) counts[Math.min(n - 1, Math.max(0, Math.floor(v / step)))]++;
  return counts.map((c, i) => ({ id: String(i), label: label(i * step, (i + 1) * step), value: c, lo: i * step, hi: i === n - 1 ? Infinity : (i + 1) * step }));
}

export const routes: StatModule = {
  id: "routes",
  order: 6,
  card: (ctx) => {
    const uniq = routesFrom(ctx.flights, false).size;
    const prev = ctx.compareFlights ? routesFrom(ctx.compareFlights, false).size : null;
    return {
      eyebrow: "Routes",
      headline: `${uniq.toLocaleString()} Routes`,
      stats: [{ value: uniq, unit: "unique", compareValue: prev }],
    };
  },
  Panel: ({ ctx }) => {
    const [directed, setDirected] = useState<"undirected" | "directed">("undirected");
    const [metric, setMetric] = useState<Metric>("flights");
    const [histMetric, setHistMetric] = useState<"distance" | "time">("distance");
    const [rankDir, setRankDir] = useState<"longest" | "shortest">("longest");
    const [rankMetric, setRankMetric] = useState<"distance" | "time">("distance");
    const [rankTrip, setRankTrip] = useState<"all" | "domestic" | "international">("all");
    const [showRankings, setShowRankings] = useState(false);
    const [rankScope, setRankScope] = useState<"routes" | "flights">("routes");
    const { toggleCrossFilter } = useStore();
    const km = ctx.settings.units === "km";
    const showTracks = ctx.settings.showTracks;

    // main chart: top routes, each stacked by airline
    const main = routesByAirline(ctx.flights, directed === "directed", metric);

    // histogram: distribution of flights by per-flight distance or air time, fixed bins
    const histRows =
      histMetric === "distance"
        ? histogram(
            ctx.flights.map((f) => (km ? flightDistanceMi(f) * MI_TO_KM : flightDistanceMi(f))),
            km ? DIST_STEP_KM : DIST_STEP_MI,
            (lo, hi) => `${compact(lo)}–${compact(hi)}`,
          )
        : histogram(
            ctx.flights.map((f) => flightMinutes(f)),
            TIME_STEP_MIN,
            (lo, hi) => `${lo / 60}–${hi / 60}h`,
          );

    // rankings (in modal): longest/shortest by per-flight distance or air time,
    // optionally filtered to domestic / international. International = one colour;
    // domestic routes split by their country (top countries + "other").
    const domCount = new Map<string, number>();
    for (const f of ctx.flights) {
      if (f.trip_type !== "domestic") continue;
      const c = f.dep_country_name ?? f.dep_country;
      if (c) domCount.set(c, (domCount.get(c) ?? 0) + 1);
    }
    const topDom = [...domCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, DOM_PALETTE.length).map(([c]) => c);
    const countryColor = new Map(topDom.map((c, i) => [c, DOM_PALETTE[i]]));
    const rankColor = (tripType: string, country: string) =>
      tripType === "international" ? INTL_COLOR : countryColor.get(country) ?? OTHER;

    const undirected = [...routesFrom(ctx.flights, false).values()].map((r) => ({
      id: r.key,
      label: `${r.dep} · ${r.arr}`,
      dep: r.dep,
      arr: r.arr,
      tripType: r.tripType,
      country: r.tripType === "domestic" ? r.sampleFlight.dep_country_name ?? r.sampleFlight.dep_country ?? "" : "",
      // great-circle distance (constant per route; actual filed distance varies per flight)
      distance: r.sampleFlight.distance_mi ?? 0,
      time: r.minutes / r.flights, // average air time across the route's flights
    }));
    const rankRows = undirected
      .filter((r) => rankTrip === "all" || r.tripType === rankTrip)
      .map((r) => ({
        id: r.id,
        label: r.label,
        dep: r.dep,
        arr: r.arr,
        tripType: r.tripType ?? "",
        country: r.country,
        value: Math.round(rankMetric === "distance" ? r.distance : r.time),
      }))
      .sort((a, b) => (rankDir === "longest" ? b.value - a.value : a.value - b.value))
      .map((r, i) => ({ ...r, label: `${i + 1}. ${r.label}` })); // rank prefix shows on the axis + hover

    // per-flight rankings (no route dedup) — only meaningful with tracks (flown distance)
    const flightRankRows = ctx.flights
      .filter((f) => rankTrip === "all" || f.trip_type === rankTrip)
      .map((f) => ({
        id: f.id,
        label: `${f.dep_iata} → ${f.arr_iata} · ${f.flight_date}`,
        dep: f.dep_iata,
        arr: f.arr_iata,
        tripType: f.trip_type ?? "",
        country: f.trip_type === "domestic" ? f.dep_country_name ?? f.dep_country ?? "" : "",
        gc: Math.round(f.distance_mi ?? 0),
        value: Math.round(rankMetric === "distance" ? flightDistanceMi(f) : flightMinutes(f)),
      }))
      .sort((a, b) => (rankDir === "longest" ? b.value - a.value : a.value - b.value))
      .map((r, i) => ({ ...r, label: `${i + 1}. ${r.label}` }));

    const rankingRows = rankScope === "flights" ? flightRankRows : rankRows;
    // flights-by-distance: stack great-circle + the extra flown over it (lighter shade)
    const splitGc = rankScope === "flights" && rankMetric === "distance";
    const rankSeries: Series[] = splitGc
      ? [
          { key: "gc", name: "Great-circle", color: color.accent },
          { key: "extra", name: "Extra vs GC", color: color.accent, opacity: 0.4 },
        ]
      : [{ key: "value", name: rankMetric, color: color.accent }];
    const rankModalRows: BarRowData[] = rankingRows.map((r): BarRowData => {
      const gc = "gc" in r ? Number((r as { gc: number }).gc) : 0;
      return splitGc
        ? { id: r.id, label: r.label, gc, extra: Math.max(0, r.value - gc), tripType: r.tripType, country: r.country }
        : { id: r.id, label: r.label, value: r.value, tripType: r.tripType, country: r.country };
    });

    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            aria-label="Direction"
            size="sm"
            value={directed}
            onChange={setDirected}
            options={[
              { value: "undirected", label: "Unique" },
              { value: "directed", label: "Directed" },
            ]}
          />
          <Dropdown
            aria-label="Metric"
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "flights", label: "Flights" },
              { value: "distance", label: "Distance" },
              { value: "time", label: "Time" },
            ]}
          />
        </div>
        <BarsH
          rows={main.rows}
          series={main.series}
          unit={metric === "flights" ? "flights" : metric === "distance" ? ctx.settings.units : "min"}
          cap={8}
          onPick={(id) => {
            const r = main.rows.find((x) => x.id === id);
            if (r) toggleCrossFilter(routeFilter(String(r.dep), String(r.arr)));
          }}
        />

        <div className="mb-1.5 mt-1 flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 truncate text-eyebrow tracking-[0.01em] text-ink-faint">
            Flights by {histMetric === "distance" ? `distance (${ctx.settings.units})` : "air time"}
          </span>
          <Segmented
            aria-label="Histogram metric"
            size="sm"
            value={histMetric}
            onChange={setHistMetric}
            options={[
              { value: "distance", label: "Distance" },
              { value: "time", label: "Time" },
            ]}
          />
        </div>
        <BarsV
          rows={histRows}
          series={[{ key: "value", name: "flights", color: color.secondary }]}
          unit="flights"
          height={170}
          onPick={(id) => {
            const row = histRows.find((r) => r.id === id);
            if (!row || !row.value) return;
            if (histMetric === "distance") {
              const loMi = km ? row.lo / MI_TO_KM : row.lo;
              const hiMi = row.hi === Infinity ? Infinity : km ? row.hi / MI_TO_KM : row.hi;
              toggleCrossFilter(distanceBinFilter(loMi, hiMi, `${row.label} ${ctx.settings.units}`));
            } else {
              toggleCrossFilter(timeBinFilter(row.lo, row.hi, String(row.label)));
            }
          }}
        />

        <PanelFooter>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => { setRankScope("routes"); setShowRankings(true); }}>
              Longest &amp; shortest routes
            </Button>
            {showTracks && (
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => { setRankScope("flights"); setShowRankings(true); }}>
                Longest &amp; shortest flights
              </Button>
            )}
          </div>
        </PanelFooter>

        {showRankings && (
          <Modal title={rankScope === "flights" ? "Flight rankings" : "Route rankings"} onClose={() => setShowRankings(false)} className="w-[min(720px,95vw)]">
            <div className="flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  aria-label="Ranking"
                  size="sm"
                  value={rankDir}
                  onChange={setRankDir}
                  options={[
                    { value: "longest", label: "Longest" },
                    { value: "shortest", label: "Shortest" },
                  ]}
                />
                <Segmented
                  aria-label="Ranking metric"
                  size="sm"
                  value={rankMetric}
                  onChange={setRankMetric}
                  options={[
                    { value: "distance", label: "Distance" },
                    { value: "time", label: "Time" },
                  ]}
                />
                <Segmented
                  aria-label="Trip type"
                  size="sm"
                  value={rankTrip}
                  onChange={setRankTrip}
                  options={[
                    { value: "all", label: "All" },
                    { value: "domestic", label: "Dom" },
                    { value: "international", label: "Int" },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-muted">
                {rankTrip !== "domestic" && (
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: INTL_COLOR }} />International</span>
                )}
                {rankTrip !== "international" &&
                  topDom.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: countryColor.get(c) }} />{c}</span>
                  ))}
                {rankTrip !== "international" && (
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: OTHER }} />Domestic — other</span>
                )}
                <span className="ml-auto">{rankingRows.length} {rankScope === "flights" ? "flights" : "routes"}</span>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: "62vh" }}>
                <BarsH
                  rows={rankModalRows}
                  series={rankSeries}
                  unit={rankMetric === "distance" ? ctx.settings.units : "min"}
                  colorByRow={(row) => rankColor(String(row.tripType ?? ""), String(row.country ?? ""))}
                  topAxis
                />
              </div>
            </div>
          </Modal>
        )}
      </>
    );
  },
};
