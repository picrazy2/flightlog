import type { StatModule, StatContext } from "../types";
import { EntityVisitsPanel } from "../EntityVisitsPanel";
import { CATEGORICAL, color } from "@/lib/palette";
import { countryFilter } from "../filters";
import { TOTAL_COUNTRIES, REGION_NAMES } from "./continents";
import { COUNTRY_GEO, sovereignOf, TERRITORY_PARENT } from "@/lib/continents";

const INTL = color.secondary;
// country palette excludes the international colour (secondary) so no country matches it
const COUNTRY_PALETTE = CATEGORICAL.filter((c) => c.toUpperCase() !== INTL.toUpperCase());
const countryColor = (i: number) => COUNTRY_PALETTE[i % COUNTRY_PALETTE.length];

// sovereign country name from ISO (territories resolve to their parent before this)
const cName = (iso: string) => { try { return REGION_NAMES.of(iso) ?? iso; } catch { return iso; } };
function rankedCountries(ctx: StatContext) {
  const counts = new Map<string, { name: string; v: number }>();
  for (const a of ctx.airports.values()) {
    const key = sovereignOf(a.country) ?? "??"; // territories count toward their sovereign
    const cur = counts.get(key) ?? { name: key === "??" ? "??" : cName(key), v: 0 };
    cur.v += a.visits;
    counts.set(key, cur);
  }
  return [...counts.entries()].map(([id, x]) => ({ id, ...x })).sort((a, b) => b.v - a.v);
}
const colorMap = (ctx: StatContext) => new Map(rankedCountries(ctx).map((c, i) => [c.id, countryColor(i)]));

export const countries: StatModule = {
  id: "countries",
  order: 5,
  card: (ctx) => {
    // count distinct sovereign countries (territories resolve to their parent)
    const distinct = (isos: (string | null)[]) => new Set(isos.map(sovereignOf).filter((s): s is string => !!s && !!COUNTRY_GEO[s])).size;
    const n = distinct([...ctx.airports.values()].map((a) => a.country));
    const prev = ctx.compareFlights ? distinct(ctx.compareFlights.flatMap((f) => [f.dep_country, f.arr_country])) : 0;
    return { eyebrow: "Countries", headline: `${n}/${TOTAL_COUNTRIES} Countries`, stats: [{ value: n, compareValue: ctx.compareFlights ? prev : null }] };
  },
  Panel: ({ ctx }) => (
    <EntityVisitsPanel
      ctx={ctx}
      level="country"
      facet="country"
      breakdowns={["airport", "city", "type", "visitType"]}
      filterFor={(id, name) => countryFilter(id, name)}
      noun="countries"
    />
  ),
  map: {
    layers: ["choropleth"],
    colorAirport: (a, ctx) => colorMap(ctx).get(sovereignOf(a.country) ?? "??") ?? null,
    colorFlight: (f, ctx) =>
      f.trip_type === "domestic" ? colorMap(ctx).get(sovereignOf(f.dep_country) ?? "??") ?? null : INTL,
    airportLegendId: (a) => sovereignOf(a.country) ?? "??",
    flightLegendId: (f) => (f.trip_type === "domestic" ? sovereignOf(f.dep_country) ?? "??" : "intl"),
    choropleth: (ctx) => {
      const cmap = colorMap(ctx);
      const out: { iso: string; color: string }[] = [];
      for (const [iso, c] of cmap.entries()) {
        if (iso === "??") continue;
        out.push({ iso, color: c }); // sovereign polygon
        // also tint its territories the same colour (e.g. Bermuda under United Kingdom)
        for (const [t, p] of Object.entries(TERRITORY_PARENT)) if (p === iso) out.push({ iso: t, color: c });
      }
      return out;
    },
    legend: (ctx) => ({
      title: "Countries",
      // all line swatches: toggling hides/shows routes, not airport circles
      items: [
        ...rankedCountries(ctx)
          .slice(0, 7)
          .map((c, i) => ({ id: c.id, label: c.name, color: countryColor(i), swatch: "line" as const })),
        { id: "intl", label: "International", color: INTL, swatch: "line" as const },
      ],
    }),
  },
};
