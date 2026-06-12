import { useState } from "react";
import type { StatModule } from "../types";
import type { CabinClass } from "@/lib/types";
import { formatPct, flightMinutes } from "@/lib/format";
import { BarsH } from "@/components/charts/BarsH";
import { MiniStats } from "@/components/ui/MiniStat";
import { Switch } from "@/components/ui/Switch";
import { OptionsButton } from "@/components/ui/OptionsButton";
import { useStore } from "@/state/store";
import { classFilter } from "../filters";
import { color } from "@/lib/palette";
import { useMetricToggle, metricValue, metricName } from "../useMetric";

const LABELS: Record<CabinClass, string> = {
  economy: "Economy",
  premium_economy: "Premium economy",
  lie_flat_business: "Business",
  recliner_first: "First (recliner)",
  international_first: "First",
};
const ORDER: CabinClass[] = ["economy", "premium_economy", "lie_flat_business", "recliner_first", "international_first"];

export const cabinClass: StatModule = {
  id: "class",
  order: 8.5, // between Delays (8) and Time of day (9)
  card: (ctx) => {
    const pctPremium = (fs: typeof ctx.flights) => {
      const wc = fs.filter((f) => f.cabin_class);
      const prem = wc.filter((f) => f.cabin_class !== "economy").length;
      return wc.length ? (prem / wc.length) * 100 : 0;
    };
    const classes = new Set(ctx.flights.map((f) => f.cabin_class).filter(Boolean)).size;
    return {
      eyebrow: "Premium",
      title: "Class",
      headline: `${classes} Cabin ${classes === 1 ? "class" : "classes"}`,
      stats: [
        { value: pctPremium(ctx.flights), format: (n) => formatPct(n), compareValue: ctx.compareFlights ? pctPremium(ctx.compareFlights) : null },
      ],
    };
  },
  Panel: ({ ctx }) => {
    const { metric, control } = useMetricToggle();
    const [percent, setPercent] = useState(false);
    const { toggleCrossFilter, crossFilters } = useStore();

    // Headline cabin metrics (over flights whose cabin is known).
    const withCabin = ctx.flights.filter((f) => f.cabin_class);
    const isBizFirst = (c: string | null | undefined) => c === "lie_flat_business" || c === "recliner_first" || c === "international_first";
    const econN = withCabin.filter((f) => f.cabin_class === "economy").length;
    const bizN = withCabin.filter((f) => isBizFirst(f.cabin_class)).length;
    const totMin = withCabin.reduce((s, f) => s + flightMinutes(f), 0);
    const bizMin = withCabin.filter((f) => isBizFirst(f.cabin_class)).reduce((s, f) => s + flightMinutes(f), 0);
    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
    const cards = [
      { label: "Economy", value: `${pct(econN, withCabin.length)}%`, color: CLASS_COLORS.economy },
      { label: "Business + First", value: `${pct(bizN, withCabin.length)}%`, color: CLASS_COLORS.lie_flat_business },
      { label: "Time in Biz + First", value: `${pct(bizMin, totMin)}%`, color: CLASS_COLORS.international_first },
    ];

    const agg = new Map<string, { domestic: number; international: number }>();
    for (const f of ctx.facetFlights("class")) {
      if (!f.cabin_class) continue;
      const cur = agg.get(f.cabin_class) ?? { domestic: 0, international: 0 };
      if (f.trip_type === "international") cur.international += metricValue(f, metric);
      else cur.domestic += metricValue(f, metric);
      agg.set(f.cabin_class, cur);
    }
    const rows = ORDER.filter((c) => agg.has(c)).map((c) => ({
      id: c,
      label: LABELS[c],
      domestic: Math.round(agg.get(c)!.domestic),
      international: Math.round(agg.get(c)!.international),
    }));
    const activeId = crossFilters.filter((c) => c.id.startsWith("class:")).map((c) => c.id.slice("class:".length));
    return (
      <>
        <MiniStats items={cards} />
        <div className="flex items-center justify-between gap-2">
          {control}
          <OptionsButton>
            <div className="flex items-center justify-between">
              <span className="text-label text-ink-muted">100% stacked</span>
              <Switch checked={percent} onChange={setPercent} />
            </div>
          </OptionsButton>
        </div>
        <BarsH
          rows={rows}
          percent={percent}
          series={[
            { key: "domestic", name: "Domestic", color: color.accent },
            { key: "international", name: "International", color: color.secondary },
          ]}
          activeId={activeId}
          unit={metricName[metric]}
          onPick={(id) => toggleCrossFilter(classFilter(id, LABELS[id as CabinClass] ?? id))}
        />
      </>
    );
  },
  // Per-flight colouring by cabin class.
  map: {
    colorFlight: (f) => (f.cabin_class ? CLASS_COLORS[f.cabin_class] : "#5C6575"),
    flightLegendId: (f) => f.cabin_class ?? "unknown",
    legend: () => ({
      title: "Class",
      items: [
        ...ORDER.map((c) => ({ id: c, label: LABELS[c], color: CLASS_COLORS[c], swatch: "line" as const, filter: classFilter(c, LABELS[c]) })),
        { id: "unknown", label: "Unknown", color: "#5C6575", swatch: "line" as const },
      ],
    }),
  },
};

// Distinct hues across the wheel (blue / amber / green / rose / purple) so adjacent
// cabins never read as the same colour.
const CLASS_COLORS: Record<CabinClass, string> = {
  economy: "#5B9DFF",
  premium_economy: "#FFC061",
  lie_flat_business: "#34D399",
  recliner_first: "#FB7185",
  international_first: "#A78BFA",
};
