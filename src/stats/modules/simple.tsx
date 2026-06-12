import { useState } from "react";
import { countModule } from "./countModule";
import { color, CATEGORICAL } from "@/lib/palette";
import { airlineFilter, cityFilter, aircraftFilter, bodyFilter } from "../filters";
import { uniqueCount } from "@/lib/aggregate";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { BarsH, type BarRowData } from "@/components/charts/BarsH";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { BarsV } from "@/components/charts/BarsV";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { Segmented } from "@/components/ui/Segmented";
import { EntityChart } from "../EntityChart";
import { yearStack } from "../yearStack";
import { EntityVisitsPanel } from "../EntityVisitsPanel";
import { useChartType } from "../useChartType";
import { Switch } from "@/components/ui/Switch";
import { OptionsButton } from "@/components/ui/OptionsButton";
import { bodyClassOf, BODY_LABELS, type BodyClass } from "@/lib/aircraft";
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
    for (const f of ctx.facetFlights("airline")) {
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
    const activeId = crossFilters.filter((c) => c.id.startsWith("airline:")).map((c) => c.id.slice("airline:".length));
    const alColors = airlineColors(ctx);

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
        <div className="text-eyebrow tracking-[0.01em] text-ink-faint">Airlines by {metricName[metric]}, split domestic vs international</div>
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
        {(() => {
          const yc = yearStack({
            flights: ctx.facetFlights("airline"),
            entities: (f) => (f.airline_iata ? [{ id: f.airline_iata, group: f.airline_iata }] : []),
            value: (f) => metricValue(f, metric),
            label: (id) => acc.get(id)?.label ?? id,
            color: (id, i) => alColors.get(id)?.color ?? CATEGORICAL[i % CATEGORICAL.length],
            mode: "sum",
            topN: 7,
          });
          return yc.rows.length > 1 ? (
            <>
              <div className="text-eyebrow tracking-[0.01em] text-ink-faint">{metricName[metric]} per year, by top airline</div>
              <BarsV rows={yc.rows} series={yc.series} unit={metricName[metric]} />
            </>
          ) : null;
        })()}
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
      noun="cities"
    />
  ),
};

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
    const [bodyChart, setBodyChart] = useState<"bar" | "pie">("bar");
    const activeId = crossFilters.filter((c) => c.id.startsWith("aircraft:")).map((c) => c.id.slice("aircraft:".length));
    const activeBodies = new Set(crossFilters.filter((c) => c.id.startsWith("body:")).map((c) => c.id.slice("body:".length)));

    // body-class counts belong to the "body" facet → exclude it so all classes stay visible
    const bodyCount: Record<BodyClass, number> = { double: 0, wide: 0, narrow: 0, unknown: 0 };
    for (const f of ctx.facetFlights("body")) bodyCount[bodyClassOf(f)]++;
    // body class per year (for the second chart), weighted by the active metric
    const BODY_ORDER: BodyClass[] = ["wide", "narrow", "double", "unknown"];
    const bodyByYear = new Map<string, Record<BodyClass, number>>();
    const bodyMetricTotal: Record<BodyClass, number> = { double: 0, wide: 0, narrow: 0, unknown: 0 };
    for (const f of ctx.facetFlights("body")) {
      const b = bodyClassOf(f);
      const v = metricValue(f, metric);
      const y = f.flight_date.slice(0, 4);
      const r = bodyByYear.get(y) ?? { double: 0, wide: 0, narrow: 0, unknown: 0 };
      bodyByYear.set(y, r);
      r[b] += v;
      bodyMetricTotal[b] += v;
    }
    const bodyPresent = BODY_ORDER.filter((b) => bodyMetricTotal[b] > 0);
    const bodyYearRows = [...bodyByYear.keys()].sort().map((y) => {
      const r = bodyByYear.get(y)!;
      const row: BarRowData = { id: y, label: y };
      for (const b of bodyPresent) row[b] = Math.round(r[b]);
      return row;
    });
    const bodySeries = bodyPresent.map((b) => ({ key: b, name: BODY_LABELS[b], color: BODY_COLOR[b] }));
    const bodyPie = bodyPresent.map((b) => ({ id: b, name: BODY_LABELS[b], value: Math.round(bodyMetricTotal[b]), color: BODY_COLOR[b] }));

    // aircraft-type chart + tail numbers (the "aircraft" facet)
    const types = new Map<string, { label: string; domestic: number; international: number }>();
    const regFlights = new Map<string, Flight[]>();
    for (const f of ctx.facetFlights("aircraft")) {
      if (f.aircraft_type_code) {
        const v = metricValue(f, metric);
        const cur = types.get(f.aircraft_type_code) ?? {
          label: f.aircraft_type_name ?? f.aircraft_type_code,
          domestic: 0,
          international: 0,
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
      .map(([id, x]) => ({ id, label: x.label, domestic: Math.round(x.domestic), international: Math.round(x.international) }))
      .sort((a, b) => b.domestic + b.international - (a.domestic + a.international));

    // first three cards toggle the body cross-filter; tail-numbers is informational
    const bodyCards = (["wide", "narrow", "double"] as BodyClass[]).map((k) => ({
      label: BODY_LABELS[k],
      value: String(bodyCount[k]),
      color: k === "wide" ? WIDE_COLOR : k === "narrow" ? NARROW_COLOR : BODY_DOUBLE,
      active: activeBodies.has(k),
      onClick: () => toggleCrossFilter(bodyFilter(k)),
    }));
    const cards = [...bodyCards, { label: "Tail numbers", value: String(regFlights.size) }];

    return (
      <>
        <MiniStats items={cards} cols={4} />
        <div className="flex items-center justify-between gap-2">
          {control}
          <OptionsButton>
            <div className="flex items-center justify-between">
              <span className="text-label text-ink-muted">100% stacked</span>
              <Switch checked={percent} onChange={setPercent} />
            </div>
          </OptionsButton>
        </div>
        <div className="text-eyebrow tracking-[0.01em] text-ink-faint">Aircraft types by {metricName[metric]}, split domestic vs international</div>
        <BarsH
          rows={typeRows}
          percent={percent}
          series={[
            { key: "domestic", name: "Domestic", color: color.accent },
            { key: "international", name: "International", color: color.secondary },
          ]}
          activeId={activeId}
          unit={metricName[metric]}
          cap={8}
          onPick={(id) => {
            const r = typeRows.find((x) => x.id === id);
            toggleCrossFilter(aircraftFilter(id, r?.label ?? id));
          }}
        />

        {bodyYearRows.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-eyebrow tracking-[0.01em] text-ink-faint">
                Body type by {metricName[metric]}{bodyChart === "bar" ? ", by year" : " · all time"}
              </span>
              <Segmented
                aria-label="Body chart"
                size="sm"
                value={bodyChart}
                onChange={setBodyChart}
                options={[
                  { value: "bar", label: "Bar" },
                  { value: "pie", label: "Pie" },
                ]}
              />
            </div>
            {bodyChart === "pie" && <ChartLegend series={bodySeries} />}
            {bodyChart === "bar" ? (
              <BarsV rows={bodyYearRows} series={bodySeries} unit={metricName[metric]} />
            ) : (
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={bodyPie}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={2}
                      stroke="none"
                      isAnimationActive={false}
                      onClick={(e: { payload?: { id?: string } }) => e.payload?.id && toggleCrossFilter(bodyFilter(e.payload.id as BodyClass))}
                    >
                      {bodyPie.map((s) => <Cell key={s.id} fill={s.color} cursor="pointer" fillOpacity={activeBodies.size && !activeBodies.has(s.id) ? 0.3 : 1} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip unit={metricName[metric]} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </>
    );
  },
  // Per-flight colouring by aircraft body type.
  map: {
    colorFlight: (f) => BODY_COLOR[bodyClassOf(f)],
    flightLegendId: (f) => bodyClassOf(f),
    legend: () => ({
      title: "Aircraft body",
      items: (["double", "wide", "narrow", "unknown"] as BodyClass[]).map((k) => ({
        id: k,
        label: BODY_LABELS[k],
        color: BODY_COLOR[k],
        swatch: "line" as const,
        filter: bodyFilter(k),
      })),
    }),
  },
};

const BODY_DOUBLE = "#F472B6";
const BODY_UNKNOWN = "#5C6575";
const BODY_COLOR: Record<BodyClass, string> = {
  double: BODY_DOUBLE,
  wide: WIDE_COLOR,
  narrow: NARROW_COLOR,
  unknown: BODY_UNKNOWN,
};
