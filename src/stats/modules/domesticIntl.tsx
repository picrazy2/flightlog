import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type { StatModule } from "../types";
import { color } from "@/lib/palette";
import { BarsH } from "@/components/charts/BarsH";
import { BarsV } from "@/components/charts/BarsV";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { Segmented } from "@/components/ui/Segmented";
import { formatPct } from "@/lib/format";
import { useStore, ALL_TIME } from "@/state/store";
import { tripTypeFilter, yearRange, yearOfRange } from "../filters";
import { useMetricToggle, metricValue, metricName } from "../useMetric";

const split = (flights: { trip_type: string | null }[]) => {
  let dom = 0, intl = 0;
  for (const f of flights) f.trip_type === "domestic" ? dom++ : f.trip_type === "international" ? intl++ : 0;
  return { dom, intl };
};

export const domesticIntl: StatModule = {
  id: "domestic-intl",
  order: 7,
  card: (ctx) => {
    const pctIntl = (fs: { trip_type: string | null }[]) => {
      const { dom, intl } = split(fs);
      return dom + intl ? (intl / (dom + intl)) * 100 : 0;
    };
    return {
      eyebrow: "International",
      title: "Domestic & International",
      stats: [
        {
          value: pctIntl(ctx.flights),
          format: (n) => formatPct(n),
          compareValue: ctx.compareFlights ? pctIntl(ctx.compareFlights) : null,
        },
      ],
    };
  },
  Panel: ({ ctx }) => {
    const { toggleCrossFilter, range, setRange } = useStore();
    const { metric, control } = useMetricToggle();
    const [chartType, setChartType] = useState<"bar" | "pie">("bar");

    // dom/intl split per year, weighted by the active metric (over flights not narrowed by trip)
    const byYear = new Map<string, { domestic: number; international: number }>();
    let dom = 0, intl = 0;
    for (const f of ctx.facetFlights("trip")) {
      const v = metricValue(f, metric);
      const y = f.flight_date.slice(0, 4);
      const a = byYear.get(y) ?? { domestic: 0, international: 0 };
      byYear.set(y, a);
      if (f.trip_type === "domestic") { a.domestic += v; dom += v; }
      else if (f.trip_type === "international") { a.international += v; intl += v; }
    }
    dom = Math.round(dom);
    intl = Math.round(intl);
    const yearRows = [...byYear.keys()].sort().map((y) => ({
      id: y,
      label: y,
      domestic: Math.round(byYear.get(y)!.domestic),
      international: Math.round(byYear.get(y)!.international),
    }));
    const diSeries = [
      { key: "domestic", name: "Domestic", color: color.accent },
      { key: "international", name: "International", color: color.secondary },
    ];
    const yearActive = yearOfRange(range);
    const pieData = [
      { id: "domestic", name: "Domestic", value: dom, color: color.accent },
      { id: "international", name: "International", value: intl, color: color.secondary },
    ].filter((s) => s.value > 0);

    // country-pairs (undirected); domestic = same-country pairs
    const [pairMode, setPairMode] = useState<"all" | "intl" | "domestic">("all");
    const pairs = new Map<string, { label: string; v: number }>();
    for (const f of ctx.flights) {
      const a = f.dep_country_name, b = f.arr_country_name;
      if (!a || !b) continue;
      const same = a === b;
      if (pairMode === "intl" && same) continue;
      if (pairMode === "domestic" && !same) continue;
      const [x, y] = [a, b].sort();
      const key = same ? `${x}·dom` : `${x}·${y}`;
      const label = same ? `${x} (domestic)` : `${x} · ${y}`;
      const cur = pairs.get(key) ?? { label, v: 0 };
      cur.v += metricValue(f, metric);
      pairs.set(key, cur);
    }
    const pairRows = [...pairs.entries()]
      .map(([id, p]) => ({ id, label: p.label, flights: Math.round(p.v) }))
      .sort((a, b) => b.flights - a.flights);

    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {control}
          <Segmented
            aria-label="Chart"
            size="sm"
            value={chartType}
            onChange={setChartType}
            options={[
              { value: "bar", label: "Bar" },
              { value: "pie", label: "Pie" },
            ]}
          />
        </div>
        <div className="text-eyebrow tracking-[0.01em] text-ink-faint">
          Domestic vs international by {metricName[metric]}{chartType === "bar" ? ", by year" : " · all time"}
        </div>
        {chartType === "pie" && <ChartLegend series={diSeries} />}
        {chartType === "bar" ? (
          <BarsV
            rows={yearRows}
            series={diSeries}
            unit={metricName[metric]}
            activeId={yearActive}
            onPick={(id) => setRange(yearActive === id ? ALL_TIME : yearRange(id))}
          />
        ) : (
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={80}
                  paddingAngle={2}
                  isAnimationActive={false}
                  onClick={(e: { payload?: { id?: string } }) => e.payload?.id && toggleCrossFilter(tripTypeFilter(e.payload.id as "domestic" | "international"))}
                  label={(e: { name?: string; value?: number }) => `${e.name}: ${Number(e.value ?? 0).toLocaleString()}`}
                  labelLine={false}
                >
                  {pieData.map((s) => <Cell key={s.id} fill={s.color} cursor="pointer" />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-eyebrow tracking-[0.01em] text-ink-faint">Top country pairs</span>
            <Segmented
              aria-label="Pair type"
              size="sm"
              value={pairMode}
              onChange={setPairMode}
              options={[
                { value: "all", label: "All" },
                { value: "intl", label: "Intl" },
                { value: "domestic", label: "Dom" },
              ]}
            />
          </div>
          {pairRows.length > 0 ? (
            <BarsH
              rows={pairRows}
              series={[{ key: "flights", name: metricName[metric], color: color.secondary }]}
              unit={metricName[metric]}
              cap={8}
              colorByRow={(row) => (String(row.id).endsWith("·dom") ? color.accent : color.secondary)}
            />
          ) : (
            <p className="text-caption text-ink-faint">None in range.</p>
          )}
        </div>
      </>
    );
  },
  map: {
    colorFlight: (f) => (f.trip_type === "domestic" ? color.accent : color.secondary),
    flightLegendId: (f) => (f.trip_type === "domestic" ? "domestic" : "international"),
    legend: () => ({
      title: "Routes",
      items: [
        { id: "domestic", label: "Domestic", color: color.accent, swatch: "line" as const, filter: tripTypeFilter("domestic") },
        { id: "international", label: "International", color: color.secondary, swatch: "line" as const, filter: tripTypeFilter("international") },
      ],
    }),
  },
};
