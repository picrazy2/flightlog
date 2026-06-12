import { useState } from "react";
import { countModule } from "./countModule";
import { color, CATEGORICAL } from "@/lib/palette";
import { airlineFilter, cityFilter, aircraftFilter } from "../filters";
import { uniqueCount } from "@/lib/aggregate";
import { BarsH } from "@/components/charts/BarsH";
import { EntityChart } from "../EntityChart";
import { EntityVisitsPanel } from "../EntityVisitsPanel";
import { useChartType } from "../useChartType";
import { Switch } from "@/components/ui/Switch";
import { Segmented } from "@/components/ui/Segmented";
import { OptionsButton } from "@/components/ui/OptionsButton";
import { MiniStats } from "@/components/ui/MiniStat";
import { useStore } from "@/state/store";
import { useMetricToggle, metricValue, metricName } from "../useMetric";
import type { StatContext, StatModule } from "../types";
import type { Flight } from "@/lib/types";

const OTHER = "#475569"; // an airline outside the top 7 (dark slate)

// Top-7 airlines (by flights) → a colour each, cached by the flight set.
let alCache: { key: Flight[]; map: Map<string, { name: string; color: string }> } | null = null;
function airlineColors(ctx: StatContext) {
  if (alCache && alCache.key === ctx.flights) return alCache.map;
  const counts = new Map<string, { name: string; n: number }>();
  for (const f of ctx.flights) {
    const cur = counts.get(f.airline_iata) ?? { name: f.airline_name ?? f.airline_iata, n: 0 };
    cur.n++;
    counts.set(f.airline_iata, cur);
  }
  const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 7);
  const map = new Map(top.map(([iata, info], i) => [iata, { name: info.name, color: CATEGORICAL[i % CATEGORICAL.length] }]));
  alCache = { key: ctx.flights, map };
  return map;
}

export const airlines: StatModule = {
  // card (count of airlines) comes from countModule; Panel is custom below.
  ...countModule({
    id: "airlines",
    order: 5.5, // right after Countries (5), before Routes (6)
    eyebrow: "Airlines",
    unit: "airlines",
    facet: "airline",
    key: (f) => f.airline_iata,
    label: (f) => f.airline_name ?? f.airline_iata,
    filter: (id, label) => airlineFilter(id, label),
  }),
  Panel: ({ ctx }) => {
    const { toggleCrossFilter, crossFilters } = useStore();
    const { metric, control: metricControl } = useMetricToggle();
    const { chartType, control: chartControl } = useChartType();

    const acc = new Map<string, { label: string; domestic: number; international: number }>();
    for (const f of ctx.flights) {
      const k = f.airline_iata;
      if (!k) continue;
      const cur = acc.get(k) ?? { label: f.airline_name ?? f.airline_iata, domestic: 0, international: 0 };
      const v = metricValue(f, metric);
      if (f.trip_type === "international") cur.international += v;
      else cur.domestic += v;
      acc.set(k, cur);
    }
    const ranked = [...acc.entries()]
      .map(([id, x]) => ({ id, label: x.label, domestic: Math.round(x.domestic), international: Math.round(x.international), total: x.domestic + x.international }))
      .sort((a, b) => b.total - a.total);
    const activeId = crossFilters.find((c) => c.id.startsWith("airline:"))?.id.split(":")[1] ?? null;

    return (
      <>
        <div className="flex items-center justify-between gap-2">
          {metricControl}
          <OptionsButton>
            <div className="flex items-center justify-between gap-3">
              <span className="text-label text-ink-muted">Chart</span>
              {chartControl}
            </div>
          </OptionsButton>
        </div>
        <EntityChart
          rows={ranked.map((r) => ({ id: r.id, label: r.label, domestic: r.domestic, international: r.international }))}
          series={[
            { key: "domestic", name: "Domestic", color: color.accent },
            { key: "international", name: "International", color: color.secondary },
          ]}
          chartType={chartType}
          activeId={activeId}
          unit={metricName[metric]}
          onPick={(id) => {
            const r = ranked.find((x) => x.id === id);
            toggleCrossFilter(airlineFilter(id, r?.label ?? id));
          }}
        />
      </>
    );
  },
  // Per-flight colouring: each flight gets its airline's colour (top-7 by flights),
  // anything else is "other".
  map: {
    colorFlight: (f, ctx) => airlineColors(ctx).get(f.airline_iata)?.color ?? OTHER,
    flightLegendId: (f, ctx) => (airlineColors(ctx).get(f.airline_iata) ? f.airline_iata : "other"),
    legend: (ctx) => ({
      title: "Airlines",
      items: [
        ...[...airlineColors(ctx).entries()].map(([id, v]) => ({ id, label: v.name, color: v.color, swatch: "line" as const, filter: airlineFilter(id, v.name) })),
        { id: "other", label: "Other airline", color: OTHER, swatch: "line" as const },
      ],
    }),
  },
};

export const cities: StatModule = {
  id: "cities",
  order: 4,
  card: (ctx) => {
    const n = uniqueCount(ctx.flights, (f) => f.arr_city ?? f.arr_iata);
    const prev = ctx.compareFlights ? uniqueCount(ctx.compareFlights, (f) => f.arr_city ?? f.arr_iata) : null;
    return { eyebrow: "Cities", headline: `${n.toLocaleString()} Cities`, stats: [{ value: n, compareValue: prev }] };
  },
  Panel: ({ ctx }) => (
    <EntityVisitsPanel
      ctx={ctx}
      level="city"
      facet="city"
      breakdowns={["airport", "type", "visitType"]}
      filterFor={(id) => cityFilter(id)}
    />
  ),
};

// Widebody vs narrowbody — uses the aircraft_types.body_class from the DB; falls
// back to a name/code heuristic only when the reference row hasn't been enriched.
const WIDE_NAME = /(747|767|777|787|A300|A310|A330|A340|A350|A380|DC-?10|MD-?11|IL-?96|L-?1011)/i;
const WIDE_CODE = /^(B74|B76|B77|B78|A30|A310|A33|A34|A35|A38|DC10|MD11|IL96)/i;
function isWidebody(f: Flight): boolean {
  if (f.aircraft_type_body_class) return f.aircraft_type_body_class === "widebody";
  const n = f.aircraft_type_name;
  if (n) return WIDE_NAME.test(n);
  return WIDE_CODE.test(f.aircraft_type_code ?? "");
}
const WIDE_COLOR = "#A78BFA";
const NARROW_COLOR = "#5B9DFF";

export const aircraft: StatModule = {
  id: "aircraft",
  order: 10,
  card: (ctx) => {
    const n = uniqueCount(ctx.flights, (f) => f.aircraft_type_code);
    const prev = ctx.compareFlights ? uniqueCount(ctx.compareFlights, (f) => f.aircraft_type_code) : null;
    return { eyebrow: "Aircraft", headline: `${n.toLocaleString()} Aircraft types`, stats: [{ value: n, compareValue: prev }] };
  },
  Panel: ({ ctx }) => {
    const { toggleCrossFilter, crossFilters } = useStore();
    const { metric, control } = useMetricToggle();
    const [percent, setPercent] = useState(false);
    const [body, setBody] = useState<"all" | "narrow" | "wide">("all");
    const activeId = crossFilters.find((c) => c.id.startsWith("aircraft:"))?.id.split(":")[1] ?? null;

    const types = new Map<string, { label: string; domestic: number; international: number; wide: number }>();
    const regFlights = new Map<string, Flight[]>();
    let wideFlights = 0;
    let narrowFlights = 0;
    for (const f of ctx.flights) {
      if (f.aircraft_type_code) {
        const wide = isWidebody(f);
        if (wide) wideFlights++;
        else narrowFlights++;
        const v = metricValue(f, metric);
        const cur = types.get(f.aircraft_type_code) ?? {
          label: f.aircraft_type_name ?? f.aircraft_type_code,
          domestic: 0,
          international: 0,
          wide: wide ? 1 : 0,
        };
        if (f.trip_type === "international") cur.international += v;
        else cur.domestic += v;
        types.set(f.aircraft_type_code, cur);
      }
      if (f.registration) {
        const arr = regFlights.get(f.registration) ?? [];
        arr.push(f);
        regFlights.set(f.registration, arr);
      }
    }
    const typeRows = [...types.entries()]
      .map(([id, x]) => ({ id, label: x.label, domestic: Math.round(x.domestic), international: Math.round(x.international), wide: x.wide }))
      .filter((r) => body === "all" || (body === "wide" ? r.wide === 1 : r.wide === 0))
      .sort((a, b) => b.domestic + b.international - (a.domestic + a.international));
    // most-flown tails: only those flown 3+ times; hover lists the flights
    const regRows = [...regFlights.entries()]
      .filter(([, fs]) => fs.length > 2)
      .map(([id, fs]) => {
        const list = fs
          .slice()
          .sort((a, b) => a.flight_date.localeCompare(b.flight_date))
          .map((f) => `${f.airline_iata}${f.flight_number}  ${f.dep_iata}→${f.arr_iata}  ${f.flight_date}`);
        return { id, label: id, flights: fs.length, sub: list.join("\n") };
      })
      .sort((a, b) => b.flights - a.flights);

    const cards = [
      { label: "Widebody flights", value: String(wideFlights), color: WIDE_COLOR },
      { label: "Narrowbody flights", value: String(narrowFlights), color: NARROW_COLOR },
      { label: "Tail numbers", value: String(regFlights.size) },
    ];

    return (
      <>
        <MiniStats items={cards} />
        <div className="flex items-center justify-between gap-2">
          <Segmented
            aria-label="Body type"
            size="sm"
            value={body}
            onChange={setBody}
            options={[
              { value: "all", label: "All" },
              { value: "narrow", label: "Narrow" },
              { value: "wide", label: "Wide" },
            ]}
          />
          <OptionsButton>
            <div className="flex flex-col gap-2">
              {control}
              <div className="flex items-center justify-between">
                <span className="text-label text-ink-muted">100% stacked</span>
                <Switch checked={percent} onChange={setPercent} />
              </div>
            </div>
          </OptionsButton>
        </div>
        <BarsH
          rows={typeRows}
          percent={percent}
          series={[
            { key: "domestic", name: "Domestic", color: color.accent },
            { key: "international", name: "International", color: color.secondary },
          ]}
          activeId={activeId}
          unit={metricName[metric]}
          cap={10}
          onPick={(id) => {
            const r = typeRows.find((x) => x.id === id);
            toggleCrossFilter(aircraftFilter(id, r?.label ?? id));
          }}
        />
        {regRows.length > 0 && (
          <div>
            <div className="mb-1.5 text-eyebrow tracking-[0.01em] text-ink-faint">Most-flown tail numbers</div>
            <BarsH rows={regRows} series={[{ key: "flights", name: "flights", color: color.secondary }]} unit="flights" cap={5} />
          </div>
        )}
      </>
    );
  },
  // Per-flight colouring by aircraft body type.
  map: {
    colorFlight: (f) => {
      if (!f.aircraft_type_code) return BODY_UNKNOWN;
      if (f.aircraft_type_deck_count === 2) return BODY_DOUBLE;
      return isWidebody(f) ? WIDE_COLOR : NARROW_COLOR;
    },
    flightLegendId: (f) =>
      !f.aircraft_type_code ? "unknown" : f.aircraft_type_deck_count === 2 ? "double" : isWidebody(f) ? "wide" : "narrow",
    legend: () => ({
      title: "Aircraft body",
      items: [
        { id: "double", label: "Double-decker", color: BODY_DOUBLE, swatch: "line" },
        { id: "wide", label: "Widebody", color: WIDE_COLOR, swatch: "line" },
        { id: "narrow", label: "Narrowbody", color: NARROW_COLOR, swatch: "line" },
        { id: "unknown", label: "Unknown", color: BODY_UNKNOWN, swatch: "line" },
      ],
    }),
  },
};

const BODY_DOUBLE = "#F472B6";
const BODY_UNKNOWN = "#5C6575";
