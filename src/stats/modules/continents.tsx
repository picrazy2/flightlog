import { useState } from "react";
import type { StatModule, StatContext } from "../types";
import { CONTINENTS, COUNTRY_GEO, TERRITORY_PARENT, sovereignOf, type ContinentCode } from "@/lib/continents";
import { BarsV } from "@/components/charts/BarsV";
import { type BarRowData } from "@/components/charts/BarsH";
import { Segmented } from "@/components/ui/Segmented";
import { Chevron } from "@/components/ui/Icon";
import { Collapse } from "@/components/ui/Collapse";
import { categoricalFor, color } from "@/lib/palette";
import { useStore, type CrossFilter } from "@/state/store";
import { continentFilter, regionFilter } from "../filters";
import { yearStack } from "../yearStack";

const CONT_NAME: Record<string, string> = Object.fromEntries(CONTINENTS.map((c) => [c.code, c.name]));

// Six distinct hues; none is the amber reserved for inter-continental (color.secondary).
export const CONT_COLOR: Record<ContinentCode, string> = {
  AF: "#FB923C", // orange
  AS: "#FB7185", // rose
  EU: "#5B9DFF", // blue
  NA: "#34D399", // green
  OC: "#A78BFA", // purple
  SA: "#22D3EE", // cyan
};
const INTERCONT = color.secondary; // inter-continental flights (amber)

// Countries to tint on the map for the active geo cross-filters (country / region /
// continent), each in its continent's colour. Empty when no geo filter is active.
export function geoFilterFillColors(filters: CrossFilter[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of filters) {
    const sep = f.id.indexOf(":");
    const kind = f.id.slice(0, sep);
    const val = f.id.slice(sep + 1);
    if (kind === "country") {
      const cont = COUNTRY_GEO[val]?.continent;
      if (cont) {
        m.set(val, CONT_COLOR[cont]);
        for (const [t, p] of Object.entries(TERRITORY_PARENT)) if (p === val) m.set(t, CONT_COLOR[cont]); // its territories too
      }
    } else if (kind === "continent") {
      for (const [iso, g] of Object.entries(COUNTRY_GEO)) if (g.continent === val) m.set(iso, CONT_COLOR[val as ContinentCode]);
      for (const [t, p] of Object.entries(TERRITORY_PARENT)) if (COUNTRY_GEO[p]?.continent === val) m.set(t, CONT_COLOR[val as ContinentCode]);
    } else if (kind === "region") {
      for (const [iso, g] of Object.entries(COUNTRY_GEO)) if (g.subregion === val) m.set(iso, CONT_COLOR[g.continent]);
      for (const [t, p] of Object.entries(TERRITORY_PARENT)) { const g = COUNTRY_GEO[p]; if (g?.subregion === val) m.set(t, CONT_COLOR[g.continent]); }
    }
  }
  return m;
}

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
export const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (iso: string) => {
  try {
    return REGION_NAMES.of(iso) ?? iso;
  } catch {
    return iso;
  }
};
const flagEmoji = (iso: string) =>
  /^[A-Za-z]{2}$/.test(iso) ? String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
const countriesInRegion = (sub: string) =>
  Object.entries(COUNTRY_GEO).filter(([, g]) => g.subregion === sub).map(([iso]) => iso).sort((a, b) => countryName(a).localeCompare(countryName(b)));

export const TOTAL_COUNTRIES = Object.keys(COUNTRY_GEO).length;
export const TOTAL_REGIONS = TOTAL_BY_SUBREGION.size;

function visitedCountries(ctx: StatContext) {
  const m = new Map<string, { visits: number; name: string }>();
  for (const a of ctx.airports.values()) {
    const sov = sovereignOf(a.country); // a territory counts toward its parent
    if (!sov || !COUNTRY_GEO[sov]) continue;
    const cur = m.get(sov) ?? { visits: 0, name: a.countryName ?? sov };
    cur.visits += a.visits;
    m.set(sov, cur);
  }
  return m;
}
const contOf = (iso: string | null) => {
  const s = sovereignOf(iso);
  return s ? COUNTRY_GEO[s]?.continent ?? null : null;
};

export const continents: StatModule = {
  id: "continents",
  order: 5.25, // right after Countries (5), before Airlines (5.5)
  card: (ctx) => {
    const v = visitedCountries(ctx);
    const cv = new Set([...v.keys()].map((iso) => COUNTRY_GEO[iso].continent)).size;
    const rv = new Set([...v.keys()].map((iso) => COUNTRY_GEO[iso].subregion)).size;
    const prev = ctx.compareFlights
      ? new Set(ctx.compareFlights.flatMap((f) => [contOf(f.dep_country), contOf(f.arr_country)]).filter(Boolean)).size
      : null;
    return {
      eyebrow: "Continents",
      headline: `${cv}/6 Continents, ${rv}/${TOTAL_REGIONS} Regions`,
      stats: [{ value: cv, format: (x) => ({ value: `${x}/6`, unit: "" }), compareValue: ctx.compareFlights ? prev : null }],
    };
  },
  Panel: ({ ctx }) => {
    const { toggleCrossFilter, crossFilters } = useStore();
    const [metric, setMetric] = useState<"countries" | "visits">("countries");
    const [display, setDisplay] = useState<"percent" | "number">("percent");
    const [expanded, setExpanded] = useState<ContinentCode | null>(null);
    const activeCont = crossFilters.filter((c) => c.id.startsWith("continent:")).map((c) => c.id.slice("continent:".length));
    const activeRegions = new Set(crossFilters.filter((c) => c.id.startsWith("region:")).map((c) => c.id.slice("region:".length)));

    // continent chart shouldn't collapse when you select continents → exclude that facet
    const visited = visitedCountries({ ...ctx, flights: ctx.flights });
    const visitedByCont = new Map<ContinentCode, Set<string>>();
    for (const iso of visited.keys()) {
      const c = COUNTRY_GEO[iso].continent;
      (visitedByCont.get(c) ?? visitedByCont.set(c, new Set()).get(c)!).add(iso);
    }
    const subVisited = (cont: ContinentCode, sub: string) =>
      [...(visitedByCont.get(cont) ?? [])].filter((iso) => COUNTRY_GEO[iso].subregion === sub).length;

    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
    const contVisits = (c: ContinentCode) => [...(visitedByCont.get(c) ?? [])].reduce((s, iso) => s + visited.get(iso)!.visits, 0);
    const totalVisits = [...visited.values()].reduce((s, x) => s + x.visits, 0) || 1;
    const isPct = display === "percent";

    // Chart 1 — vertical bars per continent. Number shows the raw count (countries → one
    // bar; visits → stacked by top country); % shows coverage (countries visited / total
    // per continent) or share of total visits.
    let rows1: BarRowData[];
    let series1: { key: string; name: string; color: string }[];
    let colorByRow1: ((r: BarRowData) => string | undefined) | undefined;
    const unit1 = isPct ? "%" : metric === "countries" ? "countries" : "visits";
    if (metric === "visits" && !isPct) {
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
    } else {
      series1 = [{ key: "v", name: unit1, color: color.accent }];
      colorByRow1 = (r) => CONT_COLOR[r.id as ContinentCode];
      rows1 = CONTINENTS.map((c) => {
        const v = metric === "countries"
          ? isPct ? pct(visitedByCont.get(c.code)?.size ?? 0, TOTAL_BY_CONT.get(c.code) ?? 0) : visitedByCont.get(c.code)?.size ?? 0
          : pct(contVisits(c.code), totalVisits); // visits + percent → share of total visits
        return { id: c.code, label: c.name, v };
      });
    }

    const cards = CONTINENTS.map((c) => ({
      label: c.name,
      value: `${visitedByCont.get(c.code)?.size ?? 0}/${TOTAL_BY_CONT.get(c.code) ?? 0}`,
      color: CONT_COLOR[c.code],
    }));

    // Expanded continent → its regions as inline mini bars, sorted by % visited.
    const expandedSubs = expanded
      ? (SUBREGIONS_OF.get(expanded) ?? [])
          .map((sub) => {
            const total = TOTAL_BY_SUBREGION.get(sub) ?? 0;
            const vis = subVisited(expanded, sub);
            return { sub, vis, total, pct: total ? Math.round((vis / total) * 100) : 0 };
          })
          .sort((a, b) => b.pct - a.pct)
      : [];

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
        <Collapse open={!!expanded}>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2/40 p-1.5">
            {expandedSubs.map(({ sub, vis, total, pct: p }) => (
              <div key={sub}>
                <button
                  onClick={() => toggleCrossFilter(regionFilter(sub))}
                  className="focus-ring grid w-full grid-cols-[6rem_1fr_auto] items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-3"
                >
                  <span className={`truncate text-left text-caption ${activeRegions.has(sub) ? "text-accent" : "text-ink-muted"}`}>{sub}</span>
                  <span className="h-2 rounded-full bg-surface-3">
                    <span className="block h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${p}%`, backgroundColor: expanded ? CONT_COLOR[expanded] : undefined }} />
                  </span>
                  <span className="tnum whitespace-nowrap text-caption text-ink-muted">
                    {vis}/{total} · <span className="text-ink">{p}%</span>
                  </span>
                </button>
                <Collapse open={activeRegions.has(sub)}>
                  <div className="flex flex-wrap gap-1 px-1.5 pb-1.5 pt-1">
                    {countriesInRegion(sub).map((iso) => {
                      const seen = visited.has(iso);
                      return (
                        <span
                          key={iso}
                          className={`rounded px-1.5 py-0.5 text-caption ${seen ? "bg-surface-3 text-ink" : "text-ink-faint line-through decoration-ink-faint/40"}`}
                        >
                          {flagEmoji(iso)} {countryName(iso)}
                        </span>
                      );
                    })}
                  </div>
                </Collapse>
              </div>
            ))}
          </div>
        </Collapse>

        <div className="flex items-center gap-2">
          <Segmented
            aria-label="Metric"
            size="sm"
            value={metric}
            onChange={(v) => setMetric(v)}
            options={[
              { value: "countries", label: "Countries" },
              { value: "visits", label: "Visits" },
            ]}
          />
          <Segmented
            aria-label="Display"
            size="sm"
            value={display}
            onChange={(v) => setDisplay(v)}
            options={[
              { value: "percent", label: "%" },
              { value: "number", label: "Number" },
            ]}
          />
        </div>
        <div>
          <div className="mb-1.5 text-eyebrow tracking-[0.01em] text-ink-faint">
            {metric === "countries"
              ? isPct ? "% of continent's countries visited" : "Countries visited per continent"
              : isPct ? "Share of total visits per continent" : "Visits per continent · by top country"}
          </div>
          <BarsV
            rows={rows1}
            series={series1}
            colorByRow={colorByRow1}
            activeId={activeCont}
            unit={unit1}
            onPick={(id) => {
              const c = CONTINENTS.find((x) => x.code === id);
              if (c) toggleCrossFilter(continentFilter(c.code, c.name));
            }}
          />
        </div>
        {(() => {
          const uniqueMode = metric === "countries";
          const yc = yearStack({
            flights: ctx.flights,
            entities: (f) =>
              [contOf(f.dep_country), contOf(f.arr_country)].filter(Boolean).map((c) => ({ id: c as string, group: c as string })),
            value: () => 1,
            label: (id) => CONT_NAME[id] ?? id,
            color: (id) => CONT_COLOR[id as ContinentCode] ?? color.secondary,
            mode: uniqueMode ? "unique" : "sum",
            topN: 6,
          });
          return yc.rows.length > 1 ? (
            <div>
              <div className="mb-1.5 text-eyebrow tracking-[0.01em] text-ink-faint">
                {uniqueMode ? "Continents visited" : "Visits"} per year, by continent
              </div>
              <BarsV rows={yc.rows} series={yc.series} unit={uniqueMode ? "continents" : "visits"} />
            </div>
          ) : null;
        })()}
      </>
    );
  },
  // Map: intra-continent flights take the continent colour; inter-continental flights
  // take the international colour. Airports/countries are tinted by continent.
  map: {
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
    legend: () => ({
      title: "Continents",
      items: [
        ...CONTINENTS.map((c) => ({ id: c.code, label: c.name, color: CONT_COLOR[c.code], swatch: "line" as const, filter: continentFilter(c.code, c.name) })),
        { id: "intercont", label: "Intercontinental", color: INTERCONT, swatch: "line" as const },
      ],
    }),
  },
};
