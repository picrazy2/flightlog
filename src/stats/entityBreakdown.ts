import type { Flight } from "@/lib/types";
import type { AirportAgg } from "@/lib/aggregate";
import type { BarRowData } from "@/components/charts/BarsH";
import type { Series } from "@/components/charts/chartTheme";
import { categoricalFor, color } from "@/lib/palette";
import { schedDep, schedArr } from "@/lib/format";
import { sovereignOf } from "@/lib/continents";

export type EntityLevel = "city" | "country";
const OTHER = "#5C6575";
const TOP = 12;
const CONNECTION_MS = 16 * 60 * 60 * 1000;

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
const regionName = (iso: string): string | null => {
  try {
    return REGION_NAMES.of(iso) ?? null;
  } catch {
    return null;
  }
};

// Outer entity (city or country) for one airport aggregate. Country: a territory resolves
// to its parent sovereign so it groups with it (matches the headline count).
function entityOf(level: EntityLevel, a: AirportAgg) {
  if (level === "country") {
    const raw = a.country ?? "??";
    const sov = sovereignOf(raw) ?? raw;
    // for a merged territory show the sovereign's name, else keep the DB country name
    const name = sov !== raw ? regionName(sov) ?? a.countryName ?? sov : a.countryName ?? sov;
    return { id: sov, name };
  }
  return { id: a.city ?? a.iata, name: a.city ?? a.iata };
}

interface Built {
  rows: BarRowData[];
  series: Series[];
  names: Map<string, string>;
}

// Shared finisher: outer entities (top N) each stacked by an inner key (top N + Other).
function assemble(byGroup: Map<string, { name: string; inner: Map<string, number> }>, innerLabel?: (k: string) => string): Built {
  const top = [...byGroup.entries()]
    .map(([id, g]) => ({ id, name: g.name, inner: g.inner, total: [...g.inner.values()].reduce((x, y) => x + y, 0) }))
    .sort((a, b) => b.total - a.total);
  const innerTotals = new Map<string, number>();
  for (const g of top) for (const [k, v] of g.inner) innerTotals.set(k, (innerTotals.get(k) ?? 0) + v);
  const topInner = [...innerTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([k]) => k);
  const series: Series[] = [
    ...topInner.map((k, i) => ({ key: k, name: innerLabel ? innerLabel(k) : k, color: categoricalFor(k, i) })),
    { key: "__other", name: "Other", color: OTHER },
  ];
  const rows: BarRowData[] = top.map((g) => {
    const row: BarRowData = { id: g.id, label: g.name };
    let other = 0;
    for (const [k, v] of g.inner) {
      if (topInner.includes(k)) row[k] = v;
      else other += v;
    }
    row.__other = other;
    return row;
  });
  return { rows, series, names: new Map(top.map((g) => [g.id, g.name])) };
}

// Entity stacked by inner airport / city — values are connection-deduped visits
// (AirportAgg.visits already counts a connection once).
export function buildStack(airports: Map<string, AirportAgg>, level: EntityLevel, innerMode: "airport" | "city"): Built {
  const byGroup = new Map<string, { name: string; inner: Map<string, number> }>();
  for (const a of airports.values()) {
    const e = entityOf(level, a);
    const ik = innerMode === "airport" ? a.iata : a.city ?? a.iata;
    const g = byGroup.get(e.id) ?? { name: e.name, inner: new Map<string, number>() };
    g.inner.set(ik, (g.inner.get(ik) ?? 0) + a.visits);
    byGroup.set(e.id, g);
  }
  return assemble(byGroup);
}

// Plain (non-stacked) count of distinct inner entities (airports / cities) per outer
// entity — the "unique airports/cities" metric.
export function buildCount(airports: Map<string, AirportAgg>, level: EntityLevel, innerMode: "airport" | "city"): Built {
  const m = new Map<string, { name: string; set: Set<string> }>();
  for (const a of airports.values()) {
    const e = entityOf(level, a);
    const ik = innerMode === "airport" ? a.iata : a.city ?? a.iata;
    const g = m.get(e.id) ?? { name: e.name, set: new Set<string>() };
    g.set.add(ik);
    m.set(e.id, g);
  }
  const rows = [...m.entries()]
    .map(([id, g]) => ({ id, label: g.name, value: g.set.size }))
    .sort((a, b) => b.value - a.value);
  return {
    rows,
    series: [{ key: "value", name: innerMode === "airport" ? "Airports" : "Cities", color: color.accent }],
    names: new Map(rows.map((r) => [r.id, r.label])),
  };
}

// Plain visit totals per entity (used for the pie).
export function buildVisits(airports: Map<string, AirportAgg>, level: EntityLevel): Built {
  const m = new Map<string, { name: string; visits: number }>();
  for (const a of airports.values()) {
    const e = entityOf(level, a);
    const x = m.get(e.id) ?? { name: e.name, visits: 0 };
    x.visits += a.visits;
    m.set(e.id, x);
  }
  const rows = [...m.entries()]
    .map(([id, x]) => ({ id, label: x.name, visits: x.visits }))
    .sort((a, b) => b.visits - a.visits);
  return { rows, series: [{ key: "visits", name: "Visits", color: color.accent }], names: new Map(rows.map((r) => [r.id, r.label])) };
}

// Entity stacked by visit type (departure / arrival / connection).
export function buildVisitTypeStack(airports: Map<string, AirportAgg>, level: EntityLevel): Built {
  const m = new Map<string, { name: string; departures: number; arrivals: number; connections: number }>();
  for (const a of airports.values()) {
    const e = entityOf(level, a);
    const x = m.get(e.id) ?? { name: e.name, departures: 0, arrivals: 0, connections: 0 };
    x.departures += Math.max(0, a.departures - a.connections);
    x.arrivals += Math.max(0, a.arrivals - a.connections);
    x.connections += a.connections;
    m.set(e.id, x);
  }
  const rows = [...m.entries()]
    .map(([id, x]) => ({ id, label: x.name, departures: x.departures, arrivals: x.arrivals, connections: x.connections }))
    .sort((a, b) => b.departures + b.arrivals + b.connections - (a.departures + a.arrivals + a.connections));
  return {
    rows,
    series: [
      { key: "departures", name: "Departures", color: color.accent },
      { key: "arrivals", name: "Arrivals", color: color.secondary },
      { key: "connections", name: "Connections", color: "#A78BFA" },
    ],
    names: new Map(rows.map((r) => [r.id, r.label])),
  };
}

// Per-airport visits split into domestic / international, with a connection counted
// as ONE visit (international if either of its two legs is international).
export function visitClassByAirport(flights: Flight[]) {
  const isDom = (f: Flight) => !!f.dep_country && !!f.arr_country && f.dep_country === f.arr_country;
  const m = new Map<string, { city: string | null; country: string | null; countryName: string | null; dom: number; intl: number }>();
  const ensure = (iata: string, city: string | null, country: string | null, countryName: string | null) => {
    let x = m.get(iata);
    if (!x) {
      x = { city, country, countryName, dom: 0, intl: 0 };
      m.set(iata, x);
    }
    return x;
  };
  for (const f of flights) {
    const d = isDom(f);
    const dep = ensure(f.dep_iata, f.dep_city, f.dep_country, f.dep_country_name);
    const arr = ensure(f.arr_iata, f.arr_city, f.arr_country, f.arr_country_name);
    if (d) {
      dep.dom++;
      arr.dom++;
    } else {
      dep.intl++;
      arr.intl++;
    }
  }
  // merge connection touches: remove the arrival of i and departure of i+1, add one
  const chrono = [...flights].sort((a, b) => schedDep(a).localeCompare(schedDep(b)));
  for (let i = 0; i < chrono.length - 1; i++) {
    const cur = chrono[i];
    const next = chrono[i + 1];
    if (cur.arr_iata !== next.dep_iata) continue;
    const gap = new Date(schedDep(next)).getTime() - new Date(schedArr(cur)).getTime();
    if (gap < 0 || gap > CONNECTION_MS) continue;
    const x = m.get(cur.arr_iata);
    if (!x) continue;
    if (isDom(cur)) x.dom--; else x.intl--; // remove arrival touch of cur
    if (isDom(next)) x.dom--; else x.intl--; // remove departure touch of next
    if (!isDom(cur) || !isDom(next)) x.intl++; else x.dom++; // merged visit
  }
  return m;
}

// Entity stacked by domestic vs international visits (connection-aware).
export function buildTypeStack(flights: Flight[], level: EntityLevel): Built {
  const byAirport = visitClassByAirport(flights);
  const m = new Map<string, { name: string; domestic: number; international: number }>();
  for (const a of byAirport.values()) {
    const rawC = a.country ?? "??";
    const id = level === "country" ? sovereignOf(rawC) ?? rawC : a.city ?? "??";
    const name = level === "country"
      ? (id !== rawC ? regionName(id) ?? a.countryName ?? id : a.countryName ?? id)
      : a.city ?? id;
    const x = m.get(id) ?? { name, domestic: 0, international: 0 };
    x.domestic += a.dom;
    x.international += a.intl;
    m.set(id, x);
  }
  const rows = [...m.entries()]
    .map(([id, x]) => ({ id, label: x.name, domestic: x.domestic, international: x.international }))
    .sort((a, b) => b.domestic + b.international - (a.domestic + a.international));
  return {
    rows,
    series: [
      { key: "domestic", name: "Domestic", color: color.accent },
      { key: "international", name: "International", color: color.secondary },
    ],
    names: new Map(rows.map((r) => [r.id, r.label])),
  };
}
