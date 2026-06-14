import type { CrossFilter, DateRange } from "@/state/store";
import { routeKeyUndirected } from "@/lib/geo";
import { COUNTRY_GEO, sovereignOf } from "@/lib/continents";
import { flightDistanceMi, flightMinutes } from "@/lib/format";
import { bodyClassOf, BODY_LABELS, type BodyClass } from "@/lib/aircraft";
import { airlineKey } from "@/lib/airlines";

export const bodyFilter = (kind: BodyClass): CrossFilter => ({
  id: `body:${kind}`,
  label: BODY_LABELS[kind],
  test: (f) => bodyClassOf(f) === kind,
});

const contOf = (iso: string | null) => {
  const s = sovereignOf(iso);
  return s ? COUNTRY_GEO[s]?.continent ?? null : null;
};
const regionOf = (iso: string | null) => {
  const s = sovereignOf(iso);
  return s ? COUNTRY_GEO[s]?.subregion ?? null : null;
};

// Centralized drill-down filter builders. Modules use these on chart-bar clicks so
// predicates stay consistent and the shell needs no per-facet logic.
export const yearFilter = (year: string): CrossFilter => ({
  id: `year:${year}`,
  label: year,
  test: (f) => f.flight_date.slice(0, 4) === year,
});

// Year(-group) chart bars drive the date RANGE (not a separate cross-filter) so they
// behave identically to picking that period in the date selector (content + compare + chip).
export const yearRange = (year: string): DateRange => ({ start: `${year}-01-01`, end: `${year}-12-31`, label: year });
export const spanRange = (y0: string, y1: string, label: string): DateRange =>
  y0 === y1 ? yearRange(y0) : { start: `${y0}-01-01`, end: `${y1}-12-31`, label };
export const rangeMatchesSpan = (r: DateRange, y0: string, y1: string): boolean =>
  r.start === `${y0}-01-01` && r.end === `${y1}-12-31`;
// The single calendar year a range represents, if it's exactly Jan 1–Dec 31 of one year.
export const yearOfRange = (r: DateRange): string | null =>
  r.start != null && r.end != null && r.start.endsWith("-01-01") && r.end.endsWith("-12-31") && r.start.slice(0, 4) === r.end.slice(0, 4)
    ? r.start.slice(0, 4)
    : null;

export const airportFilter = (iata: string): CrossFilter => ({
  id: `airport:${iata}`,
  label: iata,
  test: (f) => f.dep_iata === iata || f.arr_iata === iata,
});

export const countryFilter = (iso: string, name: string): CrossFilter => ({
  id: `country:${iso}`,
  label: name,
  // iso is a sovereign; a territory (e.g. Bermuda → GB) matches its parent country
  test: (f) => sovereignOf(f.dep_country) === iso || sovereignOf(f.arr_country) === iso,
});

// Continent / subregion of a flight = the continent/subregion of either endpoint
// (via the country → continent/subregion reference).
export const continentFilter = (code: string, name: string): CrossFilter => ({
  id: `continent:${code}`,
  label: name,
  test: (f) => contOf(f.dep_country) === code || contOf(f.arr_country) === code,
});

export const regionFilter = (region: string): CrossFilter => ({
  id: `region:${region}`,
  label: region,
  test: (f) => regionOf(f.dep_country) === region || regionOf(f.arr_country) === region,
});

export const airlineFilter = (iata: string, name: string): CrossFilter => ({
  // canonical key so Ryanair FR + RK collapse to one filter
  id: `airline:${airlineKey(iata)}`,
  label: name,
  test: (f) => airlineKey(f.airline_iata) === airlineKey(iata),
});

export const cityFilter = (city: string): CrossFilter => ({
  id: `city:${city}`,
  label: city,
  test: (f) => f.dep_city === city || f.arr_city === city,
});

export const classFilter = (cabin: string, label: string): CrossFilter => ({
  id: `class:${cabin}`,
  label,
  test: (f) => f.cabin_class === cabin,
});

export const aircraftFilter = (code: string, name: string): CrossFilter => ({
  id: `aircraft:${code}`,
  label: name,
  test: (f) => f.aircraft_type_code === code,
});

export const tripTypeFilter = (trip: "domestic" | "international"): CrossFilter => ({
  id: `trip:${trip}`,
  label: trip === "domestic" ? "Domestic" : "International",
  test: (f) => f.trip_type === trip,
});

// Distance / air-time histogram bin (click-only, not searchable). Tests the same
// per-flight value the histogram bins. hi = Infinity for the open-ended top bin.
export const distanceBinFilter = (loMi: number, hiMi: number, label: string): CrossFilter => ({
  id: `distbin:${Math.round(loMi)}-${hiMi === Infinity ? "max" : Math.round(hiMi)}`,
  label,
  test: (f) => {
    const d = flightDistanceMi(f);
    return d >= loMi && d < hiMi;
  },
});

export const timeBinFilter = (loMin: number, hiMin: number, label: string): CrossFilter => ({
  id: `timebin:${loMin}-${hiMin === Infinity ? "max" : hiMin}`,
  label,
  test: (f) => {
    const t = flightMinutes(f);
    return t >= loMin && t < hiMin;
  },
});

export const routeFilter = (dep: string, arr: string): CrossFilter => ({
  id: `route:${routeKeyUndirected(dep, arr)}`,
  label: `${dep} · ${arr}`,
  test: (f) => routeKeyUndirected(f.dep_iata, f.arr_iata) === routeKeyUndirected(dep, arr),
});

// Directed: only flights flown dep → arr (used by the Routes "Directed" view).
export const directedRouteFilter = (dep: string, arr: string): CrossFilter => ({
  id: `route:${dep}>${arr}`,
  label: `${dep} → ${arr}`,
  test: (f) => f.dep_iata === dep && f.arr_iata === arr,
});
