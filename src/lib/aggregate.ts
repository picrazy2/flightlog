import type { Flight } from "./types";
import { flightDistanceMi, flightMinutes, schedDep, schedArr } from "./format";
import { routeKeyUndirected, routeKeyDirected } from "./geo";

export interface AirportAgg {
  iata: string;
  name: string | null;
  city: string | null;
  country: string | null;
  countryName: string | null;
  lat: number | null;
  lng: number | null;
  visits: number; // departures + arrivals
  departures: number;
  arrivals: number;
  connections: number; // arrived then departed the same airport within 16h
}

const CONNECTION_WINDOW_MS = 16 * 60 * 60 * 1000;

// Aggregate every airport touched by the given flights (as dep or arr).
export function airportsFrom(flights: Flight[]): Map<string, AirportAgg> {
  const m = new Map<string, AirportAgg>();
  const ensure = (
    iata: string,
    name: string | null,
    city: string | null,
    country: string | null,
    countryName: string | null,
    lat: number | null,
    lng: number | null,
  ): AirportAgg => {
    let a = m.get(iata);
    if (!a) {
      a = { iata, name, city, country, countryName, lat, lng, visits: 0, departures: 0, arrivals: 0, connections: 0 };
      m.set(iata, a);
    }
    return a;
  };
  for (const f of flights) {
    const dep = ensure(f.dep_iata, f.dep_name, f.dep_city, f.dep_country, f.dep_country_name, f.dep_lat, f.dep_lng);
    dep.departures++;
    dep.visits++;
    const arr = ensure(f.arr_iata, f.arr_name, f.arr_city, f.arr_country, f.arr_country_name, f.arr_lat, f.arr_lng);
    arr.arrivals++;
    arr.visits++;
  }

  // Connections: an arrival followed by a departure from the SAME airport within
  // 16h, scanning the trip in chronological order.
  const chrono = [...flights].sort((x, y) => schedDep(x).localeCompare(schedDep(y)));
  for (let i = 0; i < chrono.length - 1; i++) {
    const cur = chrono[i];
    const next = chrono[i + 1];
    if (cur.arr_iata !== next.dep_iata) continue;
    const gap = new Date(schedDep(next)).getTime() - new Date(schedArr(cur)).getTime();
    if (gap >= 0 && gap <= CONNECTION_WINDOW_MS) {
      const a = m.get(cur.arr_iata);
      if (a) a.connections++;
    }
  }
  // A connection is a single visit, not two (arrival + departure), so the
  // double-counted touch is removed: visits = departures + arrivals − connections.
  for (const a of m.values()) a.visits -= a.connections;
  return m;
}

// Connection-deduped visits per arbitrary key (airport / city / country / continent) per
// year. `keyOf(f, end)` maps an endpoint to its bucket id; a connection subtracts one from
// the connecting airport's bucket. Used by every "visits per year" chart.
export function visitsByKeyYear(
  flights: Flight[],
  keyOf: (f: Flight, end: "dep" | "arr") => string | null | undefined,
): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  const bump = (key: string, year: string, d: number) => {
    const ym = m.get(key) ?? new Map<string, number>();
    ym.set(year, (ym.get(year) ?? 0) + d);
    m.set(key, ym);
  };
  for (const f of flights) {
    const y = f.flight_date.slice(0, 4);
    const dk = keyOf(f, "dep");
    if (dk) bump(dk, y, 1);
    const ak = keyOf(f, "arr");
    if (ak) bump(ak, y, 1);
  }
  const chrono = [...flights].sort((a, b) => schedDep(a).localeCompare(schedDep(b)));
  for (let i = 0; i < chrono.length - 1; i++) {
    const cur = chrono[i];
    const next = chrono[i + 1];
    if (cur.arr_iata !== next.dep_iata) continue;
    const gap = new Date(schedDep(next)).getTime() - new Date(schedArr(cur)).getTime();
    if (gap >= 0 && gap <= CONNECTION_WINDOW_MS) {
      const key = keyOf(cur, "arr"); // the connecting airport's bucket
      if (key) bump(key, cur.flight_date.slice(0, 4), -1);
    }
  }
  return m;
}

// Build BarsV rows/series (top-N keys stacked) from a key→year→value map.
type YearBarRow = { id: string; label: string; [k: string]: string | number };
export function topYearBars(
  byKeyYear: Map<string, Map<string, number>>,
  opts: { topN: number; label: (k: string) => string; color: (k: string, i: number) => string },
): { rows: YearBarRow[]; series: { key: string; name: string; color: string }[] } {
  const top = [...byKeyYear.entries()]
    .map(([k, ym]) => [k, [...ym.values()].reduce((s, v) => s + v, 0)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.topN)
    .map(([k]) => k);
  const years = [...new Set([...byKeyYear.values()].flatMap((ym) => [...ym.keys()]))].sort();
  return {
    series: top.map((k, i) => ({ key: k, name: opts.label(k), color: opts.color(k, i) })),
    rows: years.map((y) => {
      const row: YearBarRow = { id: y, label: y };
      for (const k of top) row[k] = byKeyYear.get(k)?.get(y) ?? 0;
      return row;
    }),
  };
}

export interface RouteAgg {
  key: string;
  dep: string;
  arr: string;
  flights: number;
  distanceMi: number;
  minutes: number;
  tripType: Flight["trip_type"];
  sampleFlight: Flight;
  firstDate: string; // earliest flight_date on this route
  airlines: Set<string>; // distinct airlines flown on this route
}

export function routesFrom(flights: Flight[], directed = true): Map<string, RouteAgg> {
  const m = new Map<string, RouteAgg>();
  for (const f of flights) {
    const key = directed
      ? routeKeyDirected(f.dep_iata, f.arr_iata)
      : routeKeyUndirected(f.dep_iata, f.arr_iata);
    let r = m.get(key);
    if (!r) {
      r = {
        key,
        dep: f.dep_iata,
        arr: f.arr_iata,
        flights: 0,
        distanceMi: 0,
        minutes: 0,
        tripType: f.trip_type,
        sampleFlight: f,
        firstDate: f.flight_date,
        airlines: new Set<string>(),
      };
      m.set(key, r);
    }
    r.flights++;
    r.distanceMi += flightDistanceMi(f);
    r.minutes += flightMinutes(f); // actual air time (wheels) when available
    r.airlines.add(f.airline_iata);
    if (f.flight_date < r.firstDate) r.firstDate = f.flight_date;
  }
  return m;
}

export const uniqueCount = <T>(items: T[], key: (t: T) => string | null | undefined): number => {
  const s = new Set<string>();
  for (const it of items) {
    const k = key(it);
    if (k) s.add(k);
  }
  return s.size;
};

export const sumDistanceMi = (flights: Flight[]): number =>
  flights.reduce((s, f) => s + flightDistanceMi(f), 0);

export const sumMinutes = (flights: Flight[]): number =>
  flights.reduce((s, f) => s + flightMinutes(f), 0);

// cost: dedupe by booking so a multi-leg booking is counted once. Prefer the historical
// USD (converted at the booking date); fall back to the static present-day rate.
export function totalCash(flights: Flight[], fx: (cur: string) => number): number {
  const seen = new Set<string>();
  let sum = 0;
  for (const f of flights) {
    if (!f.booking_id || seen.has(f.booking_id)) continue;
    seen.add(f.booking_id);
    if (f.cost_cash_usd != null) sum += f.cost_cash_usd;
    else if (f.cost_cash != null) sum += f.cost_cash * fx((f.cost_currency ?? "USD").toUpperCase());
  }
  return sum;
}

export function totalPoints(flights: Flight[]): number {
  const seen = new Set<string>();
  let sum = 0;
  for (const f of flights) {
    if (!f.booking_id || seen.has(f.booking_id)) continue;
    seen.add(f.booking_id);
    if (f.cost_points != null) sum += f.cost_points;
  }
  return sum;
}
