import type { MapEncoding, StatContext } from "./types";
import type { Flight } from "@/lib/types";
import { categoricalFor } from "@/lib/palette";
import { buildYearGroups } from "@/lib/yearGroups";
import { routeKeyUndirected } from "@/lib/geo";

const UNKNOWN = "#5C6575";

// Cache the year→colour mapping per flight set so colorFlight/legend agree and
// don't rebuild on every feature. Mirrors the airports-by-year chart exactly.
let cache: { key: Flight[]; groups: ReturnType<typeof buildYearGroups>["groups"]; keyOf: Map<string, string>; colorOf: Map<string, string> } | null = null;
function yearColors(ctx: StatContext) {
  if (cache && cache.key === ctx.flights) return cache;
  const years = [...new Set(ctx.flights.map((f) => f.flight_date.slice(0, 4)))];
  const { groups, keyOf } = buildYearGroups(years);
  const colorOf = new Map<string, string>();
  groups.forEach((g, i) => colorOf.set(g.key, categoricalFor(g.key, i)));
  cache = { key: ctx.flights, groups, keyOf, colorOf };
  return cache;
}
const groupKey = (f: Flight, ctx: StatContext) => yearColors(ctx).keyOf.get(f.flight_date.slice(0, 4));

// Default map colouring when tracks are on: one colour per year(-group), matching
// the "Airports by year" chart. Future flights simply colour by their year.
export const yearMapEncoding: MapEncoding = {
  colorFlight: (f, ctx) => {
    const gk = groupKey(f, ctx);
    return gk ? yearColors(ctx).colorOf.get(gk) ?? UNKNOWN : UNKNOWN;
  },
  flightLegendId: (f, ctx) => groupKey(f, ctx) ?? "unknown",
  legend: (ctx) => ({
    title: "Year",
    items: yearColors(ctx).groups.map((g, i) => ({
      id: g.key,
      label: g.label,
      color: categoricalFor(g.key, i),
      swatch: "line" as const,
    })),
  }),
};

// Route → the year it was FIRST flown. Cached on the same flight-array identity as the
// colour table above so both invalidate together.
let routeCache: { key: Flight[]; firstYearOf: Map<string, string> } | null = null;
function routeFirstYear(ctx: StatContext) {
  if (routeCache && routeCache.key === ctx.flights) return routeCache.firstYearOf;
  const firstYearOf = new Map<string, string>();
  for (const f of ctx.flights) {
    const rk = routeKeyUndirected(f.dep_iata, f.arr_iata);
    const year = f.flight_date.slice(0, 4);
    const cur = firstYearOf.get(rk);
    // Plain string compare is safe here: YYYY sorts lexicographically.
    if (cur === undefined || year < cur) firstYearOf.set(rk, year);
  }
  routeCache = { key: ctx.flights, firstYearOf };
  return firstYearOf;
}

const routeGroupKey = (f: Flight, ctx: StatContext) => {
  const year = routeFirstYear(ctx).get(routeKeyUndirected(f.dep_iata, f.arr_iata));
  return year ? yearColors(ctx).keyOf.get(year) : undefined;
};

// Default map colouring when tracks are OFF. Same year palette as the tracks-on encoding
// — a given year is the same colour either way — but the whole route takes the colour of
// the year it was FIRST flown.
//
// It has to be per-route rather than per-flight: with tracks off every flight on a route
// collapses onto one great-circle line, so colouring each flight by its own year would
// stack arcs of different colours in the same place and whichever drew last would win.
// First-flown is the meaningful choice of the ones available — it reads as "when did this
// route enter the map".
export const routeFirstYearMapEncoding: MapEncoding = {
  colorFlight: (f, ctx) => {
    const gk = routeGroupKey(f, ctx);
    return gk ? yearColors(ctx).colorOf.get(gk) ?? UNKNOWN : UNKNOWN;
  },
  flightLegendId: (f, ctx) => routeGroupKey(f, ctx) ?? "unknown",
  legend: (ctx) => {
    // Only the groups that actually own some route's first year. Under first-flown
    // colouring a year can be entirely absent (every route flown that year had already
    // been flown earlier), and a legend row that colours nothing and filters nothing is
    // noise. Colours are taken from the full group index first, so they stay identical
    // to the tracks-on legend.
    const keyOf = yearColors(ctx).keyOf;
    const used = new Set<string>();
    for (const year of routeFirstYear(ctx).values()) {
      const k = keyOf.get(year);
      if (k) used.add(k);
    }
    return {
      title: "Year first flown",
      items: yearColors(ctx).groups
        .map((g, i) => ({
          id: g.key,
          label: g.label,
          color: categoricalFor(g.key, i),
          swatch: "line" as const,
        }))
        .filter((item) => used.has(item.id)),
    };
  },
};
