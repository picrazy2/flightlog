import type { Flight, CabinClass } from "@/lib/types";
import type { CrossFilter } from "@/state/store";
import { airlineFilter, aircraftFilter, airportFilter, cityFilter, countryFilter, classFilter, tripTypeFilter, routeFilter, continentFilter, regionFilter, bodyFilter } from "./filters";
import { CABIN_LABELS } from "@/lib/cabin";
import { routeKeyUndirected } from "@/lib/geo";
import { COUNTRY_GEO, CONTINENTS, sovereignOf } from "@/lib/continents";
import { bodyClassOf, BODY_LABELS, type BodyClass } from "@/lib/aircraft";
import { airlineKey, airlineLabel } from "@/lib/airlines";

const CONT_NAME: Record<string, string> = Object.fromEntries(CONTINENTS.map((c) => [c.code, c.name]));

export interface FacetCand {
  id: string; // === filter.id
  label: string;
  filter: CrossFilter;
  weight: number;
}

export const FACET_LABELS: Record<string, string> = {
  airline: "Airline",
  aircraft: "Aircraft",
  airport: "Airport",
  city: "City",
  country: "Country",
  continent: "Continent",
  region: "Region",
  distbin: "Distance",
  timebin: "Air time",
  class: "Class",
  trip: "Trip",
  route: "Route",
  body: "Aircraft body",
};

// All selectable values per facet, derived from the FULL (unfiltered) flight set so
// the OR multi-select can offer values beyond the currently-filtered view.
export function facetOptions(flights: Flight[]): Record<string, FacetCand[]> {
  const airline = new Map<string, { name: string; n: number }>();
  const aircraft = new Map<string, { name: string; n: number }>();
  const airport = new Map<string, { label: string; n: number }>();
  const city = new Map<string, number>();
  const country = new Map<string, { name: string; n: number }>();
  const continent = new Map<string, number>();
  const region = new Map<string, number>();
  const cls = new Map<string, number>();
  const trip = new Map<string, number>();
  const body = new Map<BodyClass, number>();
  const route = new Map<string, { dep: string; arr: string; n: number }>();

  for (const f of flights) {
    if (f.airline_iata) {
      const k = airlineKey(f.airline_iata);
      const e = airline.get(k) ?? { name: airlineLabel(f.airline_iata, f.airline_name), n: 0 };
      e.n++;
      airline.set(k, e);
    }
    if (f.aircraft_type_code) {
      const e = aircraft.get(f.aircraft_type_code) ?? { name: f.aircraft_type_name ?? f.aircraft_type_code, n: 0 };
      e.n++;
      aircraft.set(f.aircraft_type_code, e);
    }
    for (const [iata, cityName] of [[f.dep_iata, f.dep_city], [f.arr_iata, f.arr_city]] as const) {
      if (iata) {
        const e = airport.get(iata) ?? { label: cityName ? `${iata} · ${cityName}` : iata, n: 0 };
        e.n++;
        airport.set(iata, e);
      }
    }
    for (const c of [f.dep_city, f.arr_city]) if (c) city.set(c, (city.get(c) ?? 0) + 1);
    for (const [iso, name] of [[f.dep_country, f.dep_country_name], [f.arr_country, f.arr_country_name]] as const) {
      if (iso) {
        const e = country.get(iso) ?? { name: name ?? iso, n: 0 };
        e.n++;
        country.set(iso, e);
      }
    }
    const conts = new Set<string>();
    const regs = new Set<string>();
    for (const iso of [f.dep_country, f.arr_country]) {
      const sov = sovereignOf(iso); // territory counts toward its parent
      const g = sov ? COUNTRY_GEO[sov] : undefined;
      if (g) {
        conts.add(g.continent);
        regs.add(g.subregion);
      }
    }
    for (const c of conts) continent.set(c, (continent.get(c) ?? 0) + 1);
    for (const r of regs) region.set(r, (region.get(r) ?? 0) + 1);
    if (f.cabin_class) cls.set(f.cabin_class, (cls.get(f.cabin_class) ?? 0) + 1);
    if (f.trip_type) trip.set(f.trip_type, (trip.get(f.trip_type) ?? 0) + 1);
    const bc = bodyClassOf(f);
    body.set(bc, (body.get(bc) ?? 0) + 1);
    const rk = routeKeyUndirected(f.dep_iata, f.arr_iata);
    const re = route.get(rk) ?? { dep: f.dep_iata, arr: f.arr_iata, n: 0 };
    re.n++;
    route.set(rk, re);
  }

  const byWeight = (a: FacetCand, b: FacetCand) => b.weight - a.weight;
  return {
    airline: [...airline].map(([id, e]) => ({ id: `airline:${id}`, label: e.name, filter: airlineFilter(id, e.name), weight: e.n })).sort(byWeight),
    aircraft: [...aircraft].map(([id, e]) => ({ id: `aircraft:${id}`, label: e.name, filter: aircraftFilter(id, e.name), weight: e.n })).sort(byWeight),
    airport: [...airport].map(([id, e]) => ({ id: `airport:${id}`, label: e.label, filter: airportFilter(id), weight: e.n })).sort(byWeight),
    city: [...city].map(([c, n]) => ({ id: `city:${c}`, label: c, filter: cityFilter(c), weight: n })).sort(byWeight),
    country: [...country].map(([iso, e]) => ({ id: `country:${iso}`, label: e.name, filter: countryFilter(iso, e.name), weight: e.n })).sort(byWeight),
    continent: [...continent].map(([code, n]) => ({ id: `continent:${code}`, label: CONT_NAME[code] ?? code, filter: continentFilter(code, CONT_NAME[code] ?? code), weight: n })).sort(byWeight),
    region: [...region].map(([r, n]) => ({ id: `region:${r}`, label: r, filter: regionFilter(r), weight: n })).sort(byWeight),
    class: [...cls].map(([c, n]) => ({ id: `class:${c}`, label: CABIN_LABELS[c as CabinClass] ?? c, filter: classFilter(c, CABIN_LABELS[c as CabinClass] ?? c), weight: n })).sort(byWeight),
    trip: [...trip].map(([t, n]) => ({ id: `trip:${t}`, label: t === "domestic" ? "Domestic" : "International", filter: tripTypeFilter(t as "domestic" | "international"), weight: n })).sort(byWeight),
    route: [...route].map(([, e]) => ({ id: `route:${routeKeyUndirected(e.dep, e.arr)}`, label: `${e.dep} · ${e.arr}`, filter: routeFilter(e.dep, e.arr), weight: e.n })).sort(byWeight),
    body: [...body].map(([k, n]) => ({ id: `body:${k}`, label: BODY_LABELS[k], filter: bodyFilter(k), weight: n })).sort(byWeight),
  };
}
