# Frontend Architecture — config-driven, zero branching

The cardinal rule: **there is no `switch (statType)` anywhere.** Every stat is a
self-contained module that *registers* everything about itself — how it's computed, its
card, its detail panel, how it recolors the map, and its legend. The app shell is generic:
it iterates the registry and renders. Adding a new stat = adding one file, touching no
shell code.

```
src/
├── app/                 # generic shell — knows nothing about specific stats
│   ├── App.tsx
│   ├── ControlBar.tsx
│   ├── StatCardsRow.tsx        # maps over registry → <StatCard>
│   ├── DetailPanelHost.tsx     # renders activeModule.Panel
│   └── MapHost.tsx             # applies activeModule.map.* + legend
├── stats/
│   ├── types.ts                # StatModule contract
│   ├── registry.ts             # REGISTRY = [overall, airports, …] (ordered)
│   ├── context.ts              # StatContext passed to every module
│   └── modules/                # ONE FILE PER STAT — the only place stat logic lives
│       ├── overall.tsx
│       ├── airports.tsx
│       ├── airlines.tsx
│       ├── cities.tsx
│       ├── countries.tsx
│       ├── routes.tsx
│       ├── domesticIntl.tsx
│       ├── delays.tsx
│       ├── timeOfDay.tsx
│       ├── aircraft.tsx
│       └── cost.tsx
├── components/ui/       # leaf components (Button, Segmented, Card, StatCard, Panel, Legend…)
├── map/                 # MapLibre setup, layers, colorBy is driven BY the active module
├── lib/                 # pure fns: format, geo (great-circle), chartTheme, supabase
├── data/                # react-query hooks against v_flights_with_airports
└── state/               # zustand: { range, compare, activeModuleId, settings, legendFilter }
```

## The `StatModule` contract

```ts
// src/stats/types.ts
export interface StatContext {
  flights: Flight[];          // already filtered by the active date range
  compareFlights?: Flight[];  // previous-period set, when compare is on
  settings: Settings;         // units (km/mi, 12/24h), etc.
  legendFilter: LegendFilter; // which legend series are toggled off
}

export interface CardModel {
  eyebrow: string;                       // e.g. "Airports"
  stats: { value: number; unit?: string; format?: Formatter }[]; // 1–3 (grouped cards)
  delta?: { pct: number };               // vs compare period → drives the ▲/▼ chip
}

export interface MapEncoding {
  // Pure functions the map calls per feature. Return null → use the map default.
  colorRoute?: (f: Flight, ctx: StatContext) => string | null;
  colorAirport?: (a: AirportAgg, ctx: StatContext) => string | null;
  sizeAirport?: (a: AirportAgg, ctx: StatContext) => number | null;
  layers?: MapLayerId[];                 // e.g. ['choropleth'] for the country module
  legend: (ctx: StatContext) => LegendModel; // interactive legend definition
}

export interface StatModule {
  id: string;                            // 'overall' | 'airports' | …
  order: number;                         // position in the row (§8 of design system)
  card: (ctx: StatContext) => CardModel; // pure → the stat card
  Panel: React.FC;                       // reads ctx via hook; the detail panel
  map?: MapEncoding;                     // optional map behavior when this module is active
}
```

```ts
// src/stats/registry.ts — the ONLY list. Order = display order.
import { overall } from "./modules/overall";
import { airports } from "./modules/airports";
// …
export const REGISTRY: StatModule[] = [
  overall, airports, airlines, cities, countries, routes,
  domesticIntl, delays, timeOfDay, aircraft, cost,
].sort((a, b) => a.order - b.order);

export const byId = (id: string) => REGISTRY.find((m) => m.id === id);
```

## How the shell consumes it (no branching)

- **StatCardsRow**: `REGISTRY.map(m => <StatCard key={m.id} model={m.card(ctx)} onClick={()=>setActive(m.id)} active={m.id===activeId} />)`.
- **DetailPanelHost**: `const M = byId(activeId); return M ? <Panel><M.Panel/></Panel> : null`.
- **MapHost**: reads `byId(activeId)?.map`. For each route/airport it calls
  `enc?.colorRoute?.(f, ctx) ?? defaultColor(f)` — the default lives in `map/colorBy.ts`,
  the override lives in the module. Choropleth/extra layers are toggled from `enc.layers`.
- **Legend**: `enc?.legend(ctx)` returns `{ title, items:[{id,label,color,active}] }`; the
  shell renders them and clicking dispatches to `state.legendFilter`. The module decides
  what the items *are*; the shell never knows.

## Why this shape

- **No conditionals across stat types.** The shell treats every module identically.
- **Cohesion.** Everything about "airports" (math + card + panel + map color + legend)
  lives in `modules/airports.tsx`. Easy to reason about, test, and delete.
- **Pure where it counts.** `card`, `colorRoute`, etc. are pure functions of
  `StatContext`, so they're trivially unit-testable and memoizable.
- **Extensible.** New stat → new module file + one line in `registry.ts`. Future "shared
  with friends", new encodings, etc. drop in the same way.

## Filtering & color-by precedence

1. Date range (+ legend isolation) filters `flights` → that's `ctx.flights`.
2. The active module's `map` encoding recolors routes/airports/choropleth.
3. Legend clicks mutate `state.legendFilter`; modules read it from `ctx` to dim/hide series.
4. With **no** active module, the map uses defaults (domestic/intl routes, visit-sized
   airports) from `map/colorBy.ts`.

Pure functions in `lib/`, declarative modules in `stats/modules/`, dumb generic shell in
`app/`. That's the whole game.
