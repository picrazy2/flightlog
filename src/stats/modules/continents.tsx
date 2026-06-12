import { useState } from "react";
import type { StatModule, StatContext } from "../types";
import { CONTINENTS, COUNTRY_GEO, type ContinentCode } from "@/lib/continents";
import { BarsV } from "@/components/charts/BarsV";
import { BarsH, type BarRowData } from "@/components/charts/BarsH";
import { Segmented } from "@/components/ui/Segmented";
import { Chevron } from "@/components/ui/Icon";
import { categoricalFor, color } from "@/lib/palette";
import { useStore } from "@/state/store";
import { continentFilter, regionFilter } from "../filters";

const CONT_COLOR: Record<ContinentCode, string> = {
  AF: "#FFC061",
  AS: "#FB7185",
  EU: "#5B9DFF",
  NA: "#34D399",
  OC: "#A78BFA",
  SA: "#F59E0B",
};
const INTERCONT = color.secondary; // inter-continental flights

// World totals from the country reference.
const TOTAL_BY_CONT = new Map<ContinentCode, number>();
const TOTAL_BY_SUBREGION = new Map<string, number>();
const SUBREGIONS_OF = new Map<ContinentCode, string[]>();
for (const { continent, subregion } of Object.values(COUNTRY_GEO)) {
  TOTAL_BY_CONT.set(continent, (TOTAL_BY_CONT.get(continent) ?? 0) + 1);
  TOTAL_BY_SUBREGION.set(subregion, (TOTAL_BY_SUBREGION.get(subregion) ?? 0) + 1);
}
for (const c of CONTINENTS) {
  SUBREGIONS_OF.set(c.code, [...new Set(Object.values(COUNTRY_GEO).filter((g) => g.continent === c.code).map((g) => g.subregion))].sort());
}

function visitedCountries(ctx: StatContext) {
  const m = new Map<string, { visits: number; name: string }>();
  for (const a of ctx.airports.values()) {
    if (!a.country || !COUNTRY_GEO[a.country]) continue;
    const cur = m.get(a.country) ?? { visits: 0, name: a.countryName ?? a.country };
    cur.visits += a.visits;
    m.set(a.country, cur);
  }
  return m;
}
const contOf = (iso: string | null) => (iso ? COUNTRY_GEO[iso]?.continent ?? null : null);

export const continents: StatModule = {
  id: "continents",
  order: 5.25, // right after Countries (5), before Airlines (5.5)
  card: (ctx) => {
    const n = new Set([...visitedCountries(ctx).keys()].map((iso) => COUNTRY_GEO[iso].continent)).size;
    const prev = ctx.compareFlights
      ? new Set(ctx.compareFlights.flatMap((f) => [contOf(f.dep_country), contOf(f.arr_country)]).filter(Boolean)).size
      : null;
    return {
      eyebrow: "Continents",
      headline: `${n} / 6`,
      stats: [{ value: n, compareValue: ctx.compareFlights ? prev : null }],
    };
  },
  Panel: ({ ctx }) => {
    const { toggleCrossFilter, crossFilters } = useStore();
    const [metric, setMetric] = useState<"countries" | "visits">("countries");
    const [expanded, setExpanded] = useState<ContinentCode | null>(null);
    const activeCont = crossFilters.find((c) => c.id.startsWith("continent:"))?.id.split(":")[1] ?? null;
    const activeRegion = crossFilters.find((c) => c.id.startsWith("region:"))?.id.split(":")[1] ?? null;

    const visited = visitedCountries(ctx);
    const visitedByCont = new Map<ContinentCode, Set<string>>();
    for (const iso of visited.keys()) {
      const c = COUNTRY_GEO[iso].continent;
      (visitedByCont.get(c) ?? visitedByCont.set(c, new Set()).get(c)!).add(iso);
    }
    const subVisited = (cont: ContinentCode, sub: string) =>
      [...(visitedByCont.get(cont) ?? [])].filter((iso) => COUNTRY_GEO[iso].subregion === sub).length;

    // Chart 1 — vertical bars per continent. Countries: single bar (coloured by
    // continent). Visits: stacked by top country.
    let rows1: BarRowData[];
    let series1: { key: string; name: string; color: string }[];
    let colorByRow1: ((r: BarRowData) => string | undefined) | undefined;
    if (metric === "countries") {
      series1 = [{ key: "countries", name: "countries", color: color.accent }];
      colorByRow1 = (r) => CONT_COLOR[r.id as ContinentCode];
      rows1 = CONTINENTS.map((c) => ({ id: c.code, label: c.name, countries: visitedByCont.get(c.code)?.size ?? 0 }));
    } else {
      const top = [...visited.entries()].sort((a, b) => b[1].visits - a[1].visits).slice(0, 8).map(([iso]) => iso);
      const topSet = new Set(top);
      series1 = [
        ...top.map((iso, i) => ({ key: iso, name: visited.get(iso)!.name, color: categoricalFor(iso, i) })),
        { key: "__other", name: "Other", color: "#475569" },
      ];
      rows1 = CONTINENTS.map((c) => {
        const row: BarRowData = { id: c.code, label: c.name };
        for (const s of series1) row[s.key] = 0;
        for (const iso of visitedByCont.get(c.code) ?? []) {
          const k = topSet.has(iso) ? iso : "__other";
          row[k] = (Number(row[k]) || 0) + visited.get(iso)!.visits;
        }
        return row;
      });
    }

    // Chart 2 — % of each region's countries visited; bars grouped by continent
    // (a spacer row separates continents), skinnier than the default.
    const rows2: BarRowData[] = [];
    const rowColor = new Map<string, string>();
    CONTINENTS.forEach((c, ci) => {
      for (const sub of SUBREGIONS_OF.get(c.code) ?? []) {
        const total = TOTAL_BY_SUBREGION.get(sub) ?? 0;
        const id = `${c.code}:${sub}`;
        rows2.push({ id, label: sub, pct: total ? Math.round((subVisited(c.code, sub) / total) * 100) : 0 });
        rowColor.set(id, CONT_COLOR[c.code]);
      }
      if (ci < CONTINENTS.length - 1) rows2.push({ id: `__gap${ci}`, label: "", pct: 0 });
    });
    const activeRegionRow = activeRegion ? rows2.find((r) => r.label === activeRegion)?.id ?? null : null;

    const cards = CONTINENTS.map((c) => ({
      label: c.name,
      value: `${visitedByCont.get(c.code)?.size ?? 0}/${TOTAL_BY_CONT.get(c.code) ?? 0}`,
      color: CONT_COLOR[c.code],
    }));

    return (
      <>
        {/* 6 metric cards (3 per row); click to expand a continent's per-region breakdown */}
        <div className="grid grid-cols-3 gap-1.5">
          {CONTINENTS.map((c) => {
            const open = expanded === c.code;
            return (
              <button
                key={c.code}
                onClick={() => setExpanded(open ? null : c.code)}
                className="focus-ring flex flex-col gap-1 rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-left hover:bg-surface-3"
              >
                <div className="flex items-center justify-between">
                  <span className="tnum font-display text-[1.1rem] font-bold leading-none text-ink">
                    {cards.find((x) => x.label === c.name)!.value}
                  </span>
                  <Chevron dir={open ? "up" : "down"} size={9} color="var(--ink-faint)" />
                </div>
                <span className="flex items-center gap-1.5 text-caption text-ink-muted">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: CONT_COLOR[c.code] }} />
                  {c.name}
                </span>
              </button>
            );
          })}
        </div>
        {expanded && (
          <div className="rounded-lg border border-border bg-surface-2/40 p-1">
            {(SUBREGIONS_OF.get(expanded) ?? []).map((sub) => (
              <button
                key={sub}
                onClick={() => toggleCrossFilter(regionFilter(sub))}
                className="focus-ring flex w-full items-center justify-between rounded-md px-2 py-1 text-label hover:bg-surface-3"
              >
                <span className={activeRegion === sub ? "text-accent" : "text-ink-muted"}>{sub}</span>
                <span className="tnum text-ink">
                  {subVisited(expanded, sub)} <span className="text-ink-faint">/ {TOTAL_BY_SUBREGION.get(sub) ?? 0}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <Segmented
          aria-label="Metric"
          size="sm"
          className="w-[220px]"
          value={metric}
          onChange={(v) => setMetric(v)}
          options={[
            { value: "countries", label: "Countries" },
            { value: "visits", label: "Visits" },
          ]}
        />
        <div>
          <div className="mb-1.5 text-eyebrow tracking-[0.01em] text-ink-faint">
            {metric === "countries" ? "Countries visited per continent" : "Visits per continent · by top country"}
          </div>
          <BarsV
            rows={rows1}
            series={series1}
            colorByRow={colorByRow1}
            activeId={activeCont}
            unit={metric === "countries" ? "countries" : "visits"}
            onPick={(id) => {
              const c = CONTINENTS.find((x) => x.code === id);
              if (c) toggleCrossFilter(continentFilter(c.code, c.name));
            }}
          />
        </div>
        <div>
          <div className="mb-1.5 text-eyebrow tracking-[0.01em] text-ink-faint">% of region's countries visited</div>
          <BarsH
            rows={rows2}
            series={[{ key: "pct", name: "% visited", color: color.accent }]}
            colorByRow={(r) => rowColor.get(r.id)}
            activeId={activeRegionRow}
            unit="%"
            cap={rows2.length}
            rowPx={17}
            barSize={9}
            onPick={(id) => {
              if (id.startsWith("__gap")) return;
              toggleCrossFilter(regionFilter(id.split(":")[1]));
            }}
          />
        </div>
      </>
    );
  },
  // Map: intra-continent flights take the continent colour; inter-continental flights
  // take the international colour. Airports/countries are tinted by continent.
  map: {
    layers: ["choropleth"],
    colorAirport: (a) => {
      const c = a.country ? contOf(a.country) : null;
      return c ? CONT_COLOR[c] : null;
    },
    colorFlight: (f) => {
      const d = contOf(f.dep_country);
      const a = contOf(f.arr_country);
      return d && a && d === a ? CONT_COLOR[d] : INTERCONT;
    },
    airportLegendId: (a) => (a.country ? contOf(a.country) ?? "??" : "??"),
    flightLegendId: (f) => {
      const d = contOf(f.dep_country);
      const a = contOf(f.arr_country);
      return d && a && d === a ? d : "intercont";
    },
    choropleth: () =>
      Object.entries(COUNTRY_GEO).map(([iso, g]) => ({ iso, color: CONT_COLOR[g.continent] })),
    legend: () => ({
      title: "Continents",
      items: [
        ...CONTINENTS.map((c) => ({ id: c.code, label: c.name, color: CONT_COLOR[c.code], swatch: "line" as const, filter: continentFilter(c.code, c.name) })),
        { id: "intercont", label: "Intercontinental", color: INTERCONT, swatch: "line" as const },
      ],
    }),
  },
};
