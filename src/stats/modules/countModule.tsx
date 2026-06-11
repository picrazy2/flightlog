import type { StatModule, StatContext } from "../types";
import type { Flight } from "@/lib/types";
import type { CrossFilter } from "@/state/store";
import { uniqueCount } from "@/lib/aggregate";
import { BarsH } from "@/components/charts/BarsH";
import { useStore } from "@/state/store";
import { color } from "@/lib/palette";
import { useMetricToggle, metricValue, metricName } from "../useMetric";

// Factory for the simple "count of X + top-X interactive bars" modules
// (airlines, cities, aircraft). Registry-driven, no shell branching.
export function countModule(opts: {
  id: string;
  order: number;
  eyebrow: string;
  unit: string;
  facet: string; // cross-filter id prefix, e.g. "airline"
  key: (f: Flight) => string | null | undefined;
  label: (f: Flight) => string;
  filter: (id: string, label: string) => CrossFilter;
  tickIcon?: (id: string) => string | undefined;
}): StatModule {
  const rank = (ctx: StatContext, metric: Parameters<typeof metricValue>[1]) => {
    const acc = new Map<string, { label: string; v: number }>();
    for (const f of ctx.flights) {
      const k = opts.key(f);
      if (!k) continue;
      const cur = acc.get(k) ?? { label: opts.label(f), v: 0 };
      cur.v += metricValue(f, metric);
      acc.set(k, cur);
    }
    return [...acc.entries()].map(([id, x]) => ({ id, v: Math.round(x.v), label: x.label })).sort((a, b) => b.v - a.v);
  };
  return {
    id: opts.id,
    order: opts.order,
    card: (ctx) => {
      const n = uniqueCount(ctx.flights, opts.key);
      const prev = ctx.compareFlights ? uniqueCount(ctx.compareFlights, opts.key) : 0;
      return {
        eyebrow: opts.eyebrow,
        headline: `${n.toLocaleString()} ${opts.eyebrow}`,
        stats: [{ value: n, unit: opts.unit, compareValue: ctx.compareFlights ? prev : null }],
      };
    },
    Panel: ({ ctx }) => {
      const { toggleCrossFilter, crossFilters } = useStore();
      const { metric, control } = useMetricToggle();
      const ranked = rank(ctx, metric);
      const activeId = crossFilters.find((c) => c.id.startsWith(`${opts.facet}:`))?.id.split(":")[1] ?? null;
      return (
        <>
          {control}
          <BarsH
            rows={ranked.map((r) => ({ id: r.id, label: r.label, count: r.v }))}
            series={[{ key: "count", name: metricName[metric], color: color.accent }]}
            activeId={activeId}
            unit={metricName[metric]}
            cap={12}
            tickIcon={opts.tickIcon ? (row) => opts.tickIcon!(row.id) : undefined}
            onPick={(id) => {
              const row = ranked.find((r) => r.id === id);
              toggleCrossFilter(opts.filter(id, row?.label ?? id));
            }}
          />
        </>
      );
    },
  };
}
