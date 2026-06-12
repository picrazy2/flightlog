import { useState } from "react";
import type { StatModule, StatContext } from "../types";
import { CONTINENTS, COUNTRY_GEO, type ContinentCode } from "@/lib/continents";
import { BarsV } from "@/components/charts/BarsV";
import { BarsH, type BarRowData } from "@/components/charts/BarsH";
import { MiniStats } from "@/components/ui/MiniStat";
import { Segmented } from "@/components/ui/Segmented";
import { categoricalFor } from "@/lib/palette";

// Six inhabited continents (Antarctica is excluded from COUNTRY_GEO).
const CONT_COLOR: Record<ContinentCode, string> = {
  AF: "#FFC061",
  AS: "#FB7185",
  EU: "#5B9DFF",
  NA: "#34D399",
  OC: "#A78BFA",
  SA: "#F59E0B",
};

// World totals derived once from the country reference.
const TOTAL_BY_CONT = new Map<ContinentCode, number>();
const TOTAL_BY_SUBREGION = new Map<string, number>();
const SUBREGIONS_OF = new Map<ContinentCode, string[]>(); // continent → its subregions, ordered
for (const { continent, subregion } of Object.values(COUNTRY_GEO)) {
  TOTAL_BY_CONT.set(continent, (TOTAL_BY_CONT.get(continent) ?? 0) + 1);
  TOTAL_BY_SUBREGION.set(subregion, (TOTAL_BY_SUBREGION.get(subregion) ?? 0) + 1);
}
for (const c of CONTINENTS) {
  const subs = [...new Set(Object.values(COUNTRY_GEO).filter((g) => g.continent === c.code).map((g) => g.subregion))].sort();
  SUBREGIONS_OF.set(c.code, subs);
}
const subregionColor = (sub: string) => categoricalFor(sub, [...TOTAL_BY_SUBREGION.keys()].sort().indexOf(sub));

// Visited countries (iso2 → visits + name) from the aggregated airports.
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
const continentsVisited = (ctx: StatContext) =>
  new Set([...visitedCountries(ctx).keys()].map((iso) => COUNTRY_GEO[iso].continent));

export const continents: StatModule = {
  id: "continents",
  order: 5.25, // right after Countries (5), before Airlines (5.5)
  card: (ctx) => {
    const n = continentsVisited(ctx).size;
    const prev = ctx.compareFlights
      ? new Set(
          ctx.compareFlights
            .flatMap((f) => [f.dep_country, f.arr_country])
            .filter((c): c is string => !!c && !!COUNTRY_GEO[c])
            .map((c) => COUNTRY_GEO[c].continent),
        ).size
      : null;
    return {
      eyebrow: "Continents",
      headline: `${n} of 6`,
      stats: [{ value: n, compareValue: ctx.compareFlights ? prev : null }],
    };
  },
  Panel: ({ ctx }) => {
    const [metric, setMetric] = useState<"countries" | "visits">("countries");
    const visited = visitedCountries(ctx);

    // visited iso2 set per continent
    const visitedByCont = new Map<ContinentCode, Set<string>>();
    for (const iso of visited.keys()) {
      const c = COUNTRY_GEO[iso].continent;
      const s = visitedByCont.get(c) ?? new Set<string>();
      s.add(iso);
      visitedByCont.set(c, s);
    }

    // 6 metric cards: countries visited / total, per continent
    const cards = CONTINENTS.map((c) => ({
      label: c.name,
      value: `${visitedByCont.get(c.code)?.size ?? 0}/${TOTAL_BY_CONT.get(c.code) ?? 0}`,
      color: CONT_COLOR[c.code],
    }));

    // Chart 1 — vertical bars per continent, broken down by region (countries) or by
    // top country (visits).
    let rows1: BarRowData[];
    let series1: { key: string; name: string; color: string }[];
    if (metric === "countries") {
      const presentSubs = [...new Set([...visited.keys()].map((iso) => COUNTRY_GEO[iso].subregion))].sort();
      series1 = presentSubs.map((s) => ({ key: s, name: s, color: subregionColor(s) }));
      rows1 = CONTINENTS.map((c) => {
        const row: BarRowData = { id: c.code, label: c.name };
        for (const s of presentSubs) row[s] = 0;
        for (const iso of visitedByCont.get(c.code) ?? []) row[COUNTRY_GEO[iso].subregion] = (Number(row[COUNTRY_GEO[iso].subregion]) || 0) + 1;
        return row;
      });
    } else {
      // visits: stack each continent by its top countries (top 8 globally) + Other
      const topCountries = [...visited.entries()].sort((a, b) => b[1].visits - a[1].visits).slice(0, 8).map(([iso]) => iso);
      const topSet = new Set(topCountries);
      series1 = [
        ...topCountries.map((iso, i) => ({ key: iso, name: visited.get(iso)!.name, color: categoricalFor(iso, i) })),
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

    // Chart 2 — % of each region's countries visited, one bar per region, coloured by
    // continent (so bars read as grouped per continent).
    const rows2: BarRowData[] = [];
    const colorByRow = new Map<string, string>();
    for (const c of CONTINENTS) {
      for (const sub of SUBREGIONS_OF.get(c.code) ?? []) {
        const total = TOTAL_BY_SUBREGION.get(sub) ?? 0;
        const vis = [...(visitedByCont.get(c.code) ?? [])].filter((iso) => COUNTRY_GEO[iso].subregion === sub).length;
        const id = `${c.code}:${sub}`;
        rows2.push({ id, label: sub, pct: total ? Math.round((vis / total) * 100) : 0 });
        colorByRow.set(id, CONT_COLOR[c.code]);
      }
    }

    return (
      <>
        <MiniStats items={cards} />
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
            {metric === "countries" ? "Countries visited per continent · by region" : "Visits per continent · by top country"}
          </div>
          <BarsV rows={rows1} series={series1} unit={metric === "countries" ? "countries" : "visits"} />
        </div>
        <div>
          <div className="mb-1.5 text-eyebrow tracking-[0.01em] text-ink-faint">% of region's countries visited</div>
          <BarsH
            rows={rows2}
            series={[{ key: "pct", name: "% visited", color: "#5B9DFF" }]}
            colorByRow={(r) => colorByRow.get(r.id)}
            unit="%"
            cap={rows2.length}
          />
        </div>
      </>
    );
  },
};
