import { useState } from "react";
import type { StatModule } from "../types";
import { color } from "@/lib/palette";
import { BarsH } from "@/components/charts/BarsH";
import { Segmented } from "@/components/ui/Segmented";
import { formatPct } from "@/lib/format";
import { useStore } from "@/state/store";
import { tripTypeFilter } from "../filters";
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
    const { toggleCrossFilter, crossFilters } = useStore();
    const { metric, control } = useMetricToggle();
    const activeId = crossFilters.filter((c) => c.id.startsWith("trip:")).map((c) => c.id.slice("trip:".length));

    // dom/intl split weighted by the active metric (over flights not narrowed by trip,
    // so both bars stay visible and either can be toggled)
    let dom = 0, intl = 0;
    for (const f of ctx.facetFlights("trip")) {
      const v = metricValue(f, metric);
      if (f.trip_type === "domestic") dom += v;
      else if (f.trip_type === "international") intl += v;
    }
    dom = Math.round(dom);
    intl = Math.round(intl);

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
        <div className="flex items-center justify-between gap-2">
          <span className="text-eyebrow tracking-[0.01em] text-ink-faint">Domestic vs international by {metricName[metric]}</span>
          {control}
        </div>
        <BarsH
          height={110}
          rows={[
            { id: "domestic", label: "Domestic", domestic: dom, international: 0 },
            { id: "international", label: "International", domestic: 0, international: intl },
          ]}
          series={[
            { key: "domestic", name: "Domestic", color: color.accent },
            { key: "international", name: "International", color: color.secondary },
          ]}
          activeId={activeId}
          unit={metricName[metric]}
          onPick={(id) => toggleCrossFilter(tripTypeFilter(id as "domestic" | "international"))}
        />
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
