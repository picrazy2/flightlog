import type { ReactNode } from "react";
import type { Flight, Settings } from "@/lib/types";
import type { AirportAgg } from "@/lib/aggregate";
import type { LegendFilter, CrossFilter } from "@/state/store";

// Everything a module needs, prepared by the shell. Pure data in → pure model out.
export interface StatContext {
  flights: Flight[]; // filtered by the active date range, temporal + all cross-filters
  compareFlights: Flight[] | null; // previous-period set when compare is on
  airports: Map<string, AirportAgg>;
  settings: Settings;
  legendFilter: LegendFilter;
  crossFilterIds: string[]; // active drill-filter ids (for highlight state)
  // 'delta' = compareFlights is the previous period; 'recent' = it's the last 12
  // months (All-time view); null = no comparison.
  compareMode: "delta" | "recent" | null;
}

export type Formatter = (n: number, s: Settings) => { value: string; unit: string; full?: string };

export interface CardStat {
  value: number;
  unit?: string;
  format?: Formatter;
  // Same metric computed over ctx.compareFlights. The card renders it as a ▲/▼ delta
  // (bounded range) or as a green "last 12 months" figure (All time). null → nothing.
  compareValue?: number | null;
}

export interface CardModel {
  eyebrow: string; // label on the stat card
  title?: string; // panel header title (defaults to eyebrow)
  headline?: string; // panel header headline, e.g. "23 Airports" (overrides title)
  stats: CardStat[]; // 1 normally; 2–3 for grouped cards (overall, cost)
}

export type MapLayerId = "choropleth";

export interface LegendItem {
  id: string;
  label: string;
  color: string;
  swatch?: "line" | "dot" | "ramp";
  filter?: CrossFilter; // clicking applies this as a global cross-filter (isolate)
}
export interface LegendModel {
  title: string;
  items: LegendItem[];
}

// Pure encoders the map calls per feature. Return null → map default applies.
// Lines are rendered PER FLIGHT (one feature per flight: its track when available,
// else a great-circle), so colour/legend encoders operate on individual flights.
export interface MapEncoding {
  colorFlight?: (f: Flight, ctx: StatContext) => string | null;
  colorAirport?: (a: AirportAgg, ctx: StatContext) => string | null;
  sizeAirport?: (a: AirportAgg, ctx: StatContext) => number | null;
  layers?: MapLayerId[];
  legend?: (ctx: StatContext) => LegendModel;
  // Map a feature to a legend item id so legend clicks can hide it (optional).
  flightLegendId?: (f: Flight, ctx: StatContext) => string | null;
  airportLegendId?: (a: AirportAgg, ctx: StatContext) => string | null;
  // Country fill colors for the choropleth layer (ISO-A2 → color).
  choropleth?: (ctx: StatContext) => { iso: string; color: string }[];
}

// A stat module = one self-contained file. No shell-side branching.
export interface StatModule {
  id: string;
  order: number;
  card: (ctx: StatContext) => CardModel;
  Panel: (props: { ctx: StatContext }) => ReactNode;
  map?: MapEncoding;
}
