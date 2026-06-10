# Journia — flight log

Personal flight-log web app: a dark MapLibre canvas of every flight + airport, with a
config-driven stats layer. Backend is Supabase (Postgres + Edge Functions); see
`DECISIONS.md`.

## Docs
- `docs/DESIGN_SYSTEM.md` — tokens, type, color, motion, component rules.
- `docs/ARCHITECTURE.md` — the registry pattern (no per-stat branching).
- `docs/PRODUCT_SPEC.md` — full feature spec / backlog.

## Run the frontend
```bash
cp .env.example .env.local   # anon key + url already filled for this project in .env.local
npm install
npm run dev                  # http://localhost:5173
```
`npm run build` → static bundle in `dist/` (GitHub Pages base `/flightlog/`).

Reads go through the Supabase **anon key** against `v_flights_with_airports`. Writes (the
＋ table/add modal, when built) call edge functions with `VITE_EDGE_FUNCTION_SECRET`.

## Adding a stat (the only pattern)
Create `src/stats/modules/<id>.tsx` exporting a `StatModule` (its `card`, `Panel`, and
optional `map` encoding), then add it to `src/stats/registry.ts`. The shell renders it
automatically — no other file changes. See `docs/ARCHITECTURE.md`.

## Status
- Dark map: great-circle routes + visit-sized airports + hover/click popups + search fly/fit.
- Floating control bar: date range + compare + autocomplete search; filter chips for drill-downs.
- 11 registry-driven stat cards with per-stat deltas vs the comparison period.
- Detail panels with **interactive Recharts** bar charts: hover tooltips, **click a bar to
  cross-filter** the whole app (map + cards + panels), **stacked + 100%-stacked** (airports),
  overflow toggles tucked into an **⋯ options** popover.
- Interactive legend (click filter / shift-isolate) drives the map.

Next (see `docs/PRODUCT_SPEC.md`): choropleth + globe projection, actual-track rendering,
line charts for delays/time-of-day (scheduled vs actual), the database table/add modal,
richer comparison-window logic, airline logos.
