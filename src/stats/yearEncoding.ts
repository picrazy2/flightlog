import type { MapEncoding, StatContext } from "./types";
import type { Flight } from "@/lib/types";
import { categoricalFor } from "@/lib/palette";
import { buildYearGroups } from "@/lib/yearGroups";

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
