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
import { CONT_COLOR } from "./continents";
import { COUNTRY_GEO, sovereignOf, CONTINENTS, type ContinentCode } from "@/lib/continents";

type Metric = "flights" | "distance" | "time";
type RankMetric = "distance" | "time" | "speed";
type Breakdown = "country" | "region" | "continent";
const CONT_NAME: Record<string, string> = Object.fromEntries(CONTINENTS.map((c) => [c.code, c.name]));
const contOf = (iso?: string | null) => {
  const s = sovereignOf(iso);
  return s ? COUNTRY_GEO[s]?.continent ?? null : null;
};
const regionOf = (iso?: string | null) => {
  const s = sovereignOf(iso);
  return s ? COUNTRY_GEO[s]?.subregion ?? null : null;
};
// sort by value (longest desc / shortest asc); null values ("n/a") always sort to the end
function sortRank<T extends { value: number | null }>(rows: T[], dir: "longest" | "shortest"): T[] {
  return [...rows].sort((a, b) => {
    if (a.value == null) return b.value == null ? 0 : 1;
    if (b.value == null) return -1;
    return dir === "longest" ? b.value - a.value : a.value - b.value;
  });
}
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
    const [rankMetric, setRankMetric] = useState<RankMetric>("distance");
    const [rankTrip, setRankTrip] = useState<"all" | "domestic" | "international">("all");
    const [rankBreakdown, setRankBreakdown] = useState<Breakdown>("country");
    const [showRankings, setShowRankings] = useState(false);
    const [rankScope, setRankScope] = useState<"routes" | "flights">("routes");
    const { toggleCrossFilter, crossFilters } = useStore();
    const activeRoutes = crossFilters.filter((c) => c.id.startsWith("route:")).map((c) => c.id.slice("route:".length));
    const km = ctx.settings.units === "km";
    const showTracks = ctx.settings.showTracks;

    // main chart: top routes, each stacked by airline (exclude the route facet so picking
    // a route doesn't hide the others — supports selecting several)
    const main = routesByAirline(ctx.facetFlights("route"), directed === "directed", metric);

    // histogram: distribution of flights by per-flight distance or air time, fixed bins.
    // Exclude the matching bin facet so the distribution stays whole under multi-select.
    const histFlights = ctx.facetFlights(histMetric === "distance" ? "distbin" : "timebin");
    const histRows =
      histMetric === "distance"
        ? histogram(
            histFlights.map((f) => (km ? flightDistanceMi(f) * MI_TO_KM : flightDistanceMi(f))),
            km ? DIST_STEP_KM : DIST_STEP_MI,
            (lo, hi) => `${compact(lo)}–${compact(hi)}`,
          )
        : histogram(
            histFlights.map((f) => flightMinutes(f)),
            TIME_STEP_MIN,
            (lo, hi) => `${lo / 60}–${hi / 60}h`,
          );

    // rankings (in modal): longest/shortest by per-flight/route distance, air time, or
    // speed, optionally filtered to domestic / international. Bars are coloured by the
    // chosen breakdown (country / region / continent); cross-group flights use one colour.
    // value is null when speed can't be computed (no real track / zero air time) — those
    // rows sort to the end and render as "n/a".
    type RankRow = {
      id: string;
      label: string;
      dep: string;
      arr: string;
      tripType: string;
      country: string;
      depC: string;
      arrC: string;
      gc: number;
      value: number | null;
    };
    const speedOf = (distMi: number, minutes: number) => (minutes > 0 ? Math.round((distMi * 60) / minutes) : null);

    const undirected = [...routesFrom(ctx.flights, false).values()].map((r) => {
      const distance = r.sampleFlight.distance_mi ?? 0; // great-circle (constant per route)
      const time = r.minutes / r.flights; // average air time across the route's flights
      return {
        id: r.key,
        label: `${r.dep} · ${r.arr}`,
        dep: r.dep,
        arr: r.arr,
        tripType: r.tripType ?? "",
        country: r.tripType === "domestic" ? r.sampleFlight.dep_country_name ?? r.sampleFlight.dep_country ?? "" : "",
        depC: r.sampleFlight.dep_country ?? "",
        arrC: r.sampleFlight.arr_country ?? "",
        gc: Math.round(distance),
        value:
          rankMetric === "distance" ? Math.round(distance) : rankMetric === "time" ? Math.round(time) : speedOf(distance, time),
      };
    });
    const rankRows: RankRow[] = sortRank(
      undirected.filter((r) => rankTrip === "all" || r.tripType === rankTrip),
      rankDir,
    );

    // per-flight rankings (no route dedup) — only meaningful with tracks (flown distance).
    // For speed, fully-GC flights (no real track) don't count → value null ("n/a").
    const flightRankRows: RankRow[] = sortRank(
      ctx.flights
        .filter((f) => rankTrip === "all" || f.trip_type === rankTrip)
        .map((f) => {
          const flown = flightDistanceMi(f);
          const minutes = flightMinutes(f);
          const hasTrack = f.flown_distance_mi != null;
          return {
            id: f.id,
            label: `${f.dep_iata} → ${f.arr_iata} · ${f.flight_date}`,
            dep: f.dep_iata,
            arr: f.arr_iata,
            tripType: f.trip_type ?? "",
            country: f.trip_type === "domestic" ? f.dep_country_name ?? f.dep_country ?? "" : "",
            depC: f.dep_country ?? "",
            arrC: f.arr_country ?? "",
            gc: Math.round(f.distance_mi ?? 0),
            value:
              rankMetric === "distance"
                ? Math.round(flown)
                : rankMetric === "time"
                ? Math.round(minutes)
                : hasTrack
                ? speedOf(flown, minutes)
                : null,
          };
        }),
      rankDir,
    );

    const rankingRows = rankScope === "flights" ? flightRankRows : rankRows;

    // colour bars by the chosen breakdown; cross-group (intl / inter-region / intercont) → INTL_COLOR
    const groupKey = (r: RankRow) => {
      if (rankBreakdown === "region") {
        const d = regionOf(r.depC), a = regionOf(r.arrC);
        return d && d === a ? d : "__inter";
      }
      if (rankBreakdown === "continent") {
        const d = contOf(r.depC), a = contOf(r.arrC);
        return d && d === a ? d : "__inter";
      }
      return r.tripType === "international" ? "__inter" : r.country || "__dom";
    };
    const groupLabel = (k: string) =>
      k === "__inter"
        ? rankBreakdown === "country"
          ? "International"
          : rankBreakdown === "region"
          ? "Inter-region"
          : "Intercontinental"
        : k === "__dom"
        ? "Domestic"
        : rankBreakdown === "continent"
        ? CONT_NAME[k] ?? k
        : k;
    const groupFreq = new Map<string, number>();
    for (const r of rankingRows) {
      const k = groupKey(r);
      if (k !== "__inter") groupFreq.set(k, (groupFreq.get(k) ?? 0) + 1);
    }
    const topGroups = [...groupFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    const groupColor = new Map<string, string>();
    topGroups.forEach((k, i) =>
      groupColor.set(
        k,
        rankBreakdown === "continent"
          ? CONT_COLOR[k as ContinentCode] ?? OTHER
          : rankBreakdown === "region"
          ? categoricalFor(k, i)
          : DOM_PALETTE[i] ?? OTHER,
      ),
    );
    const colorOf = (r: RankRow) => {
      const k = groupKey(r);
      return k === "__inter" ? INTL_COLOR : groupColor.get(k) ?? OTHER;
    };
    const hasInter = rankingRows.some((r) => groupKey(r) === "__inter");
    const hasOther = rankingRows.some((r) => {
      const k = groupKey(r);
      return k !== "__inter" && !groupColor.has(k);
    });
    const legendItems = [
      ...topGroups.filter((k) => groupColor.has(k)).map((k) => ({ label: groupLabel(k), color: groupColor.get(k)! })),
      ...(hasOther ? [{ label: "Other", color: OTHER }] : []),
      ...(hasInter ? [{ label: groupLabel("__inter"), color: INTL_COLOR }] : []),
    ];

    const rankUnit = rankMetric === "distance" ? ctx.settings.units : rankMetric === "time" ? "min" : "mph";
    // flights-by-distance: stack great-circle + the extra flown over it (lighter shade)
    const splitGc = rankScope === "flights" && rankMetric === "distance";
    const rankSeries: Series[] = splitGc
      ? [
          { key: "gc", name: "Great-circle", color: color.accent },
          { key: "extra", name: "Extra vs GC", color: color.accent, opacity: 0.4 },
        ]
      : [{ key: "value", name: rankMetric, color: color.accent }];
    const rankColorByRow = new Map(rankingRows.map((r) => [r.id, colorOf(r)]));
    const rankModalRows: BarRowData[] = rankingRows.map((r, i): BarRowData => {
      const na = r.value == null;
      const label = `${i + 1}. ${r.label}${na ? " · n/a" : ""}`; // rank prefix shows on the axis + hover
      const value = r.value ?? 0;
      return splitGc
        ? { id: r.id, label, gc: r.gc, extra: Math.max(0, value - r.gc) }
        : { id: r.id, label, value };
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
          activeId={activeRoutes}
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
                <Dropdown
                  aria-label="Ranking metric"
                  size="sm"
                  value={rankMetric}
                  onChange={setRankMetric}
                  options={[
                    { value: "distance", label: "Distance" },
                    { value: "time", label: "Time" },
                    { value: "speed", label: "Speed" },
                  ]}
                />
                <Dropdown
                  aria-label="Trip type"
                  size="sm"
                  value={rankTrip}
                  onChange={setRankTrip}
                  options={[
                    { value: "all", label: "All trips" },
                    { value: "domestic", label: "Domestic" },
                    { value: "international", label: "International" },
                  ]}
                />
                <Dropdown
                  aria-label="Colour by"
                  size="sm"
                  value={rankBreakdown}
                  onChange={setRankBreakdown}
                  options={[
                    { value: "country", label: "By country" },
                    { value: "region", label: "By region" },
                    { value: "continent", label: "By continent" },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-muted">
                {legendItems.map((it) => (
                  <span key={it.label} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: it.color }} />{it.label}</span>
                ))}
                <span className="ml-auto">{rankingRows.length} {rankScope === "flights" ? "flights" : "routes"}</span>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: "62vh" }}>
                <BarsH
                  rows={rankModalRows}
                  series={rankSeries}
                  unit={rankUnit}
                  colorByRow={(row) => rankColorByRow.get(row.id)}
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
