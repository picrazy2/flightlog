# Journia — flight log

A personal flight-log web app: a dark MapLibre canvas of every flight you've taken,
backed by a config-driven stats layer where **clicking almost anything cross-filters the
whole app**. Frontend is React + Vite + Tailwind + Recharts; backend is Supabase (Postgres
+ Edge Functions). Deployed on Cloudflare Pages at **[journia.co](https://journia.co)**.

## Docs
- `docs/ARCHITECTURE.md` — the registry pattern (no per-stat branching).
- `docs/DESIGN_SYSTEM.md` — tokens, type, color, motion, component rules.
- `docs/DECISIONS.md` — log of architectural/product decisions.

## What it does
- **Interactive map** — great-circle routes + real flown tracks on a globe or flat map
  (the opening view adapts to the window aspect ratio), coloured by any dimension; the
  flat-vs-globe and a reset-north control live on the map.
- **Stat panels** — overall, airports, cities, countries, continents, airlines, routes,
  aircraft, cabin, delays, cost & points, domestic/intl, time of day — each a registry
  module with a card + detail panel of interactive Recharts.
- **Cross-filtering** — click a bar/slice/row/airport (or the legend) to filter every chart
  and the map at once; drill into any year; search any flight, airport or route.
- **Comparison** — period-over-period ▲/▼ deltas (previous window, all-time vs past, or
  what upcoming flights will add).
- **Cost & points** — cash + award spend per booking, in any display currency at the
  historical FX rate on the flight date.
- **Data in** — AI reads booking/check-in emails and adds flights automatically
  (`watch-gmail` / `extract-emails`), or add/edit by hand and bulk-import a CSV.
- Installable PWA (full-screen on iOS), mobile + desktop shells.

## Run the frontend
```bash
cp .env.example .env.local   # VITE_SUPABASE_URL + anon key (+ edge-function secret)
npm install
npm run dev                  # http://localhost:5173
npm run build                # static bundle in dist/ (Cloudflare Pages, base "/")
```
Reads use the Supabase **anon key** against `v_flights_with_airports` / `v_flight_tracks`.
Writes (the add/edit modals, imports, enrichment) call Edge Functions authenticated with
`VITE_EDGE_FUNCTION_SECRET`.

## Adding a stat (the only pattern)
Create `src/stats/modules/<id>.tsx` exporting a `StatModule` (its `card`, `Panel`, and
optional `map` encoding), then add it to `src/stats/registry.ts`. The shell renders it
automatically — no other file changes. See `docs/ARCHITECTURE.md`.

## Backend
`supabase/functions/` holds the Edge Functions (manage/create/update/delete flight &
booking, `import-csv`, `enrich-flight`, `requery-flight`, `refresh-recent`,
`refresh-reference-data`, `watch-gmail`, `extract-emails`). Reference data: airports &
countries from OurAirports, airlines from OpenFlights, aircraft types from an open
database, FX from the @fawazahmed0 currency API, and flight schedules / actual times /
flown tracks from AeroAPI (FlightAware).

`scripts/` holds build helpers (`cf-redirects.mjs`). One-off reconciliation/backfill
utilities and scratch data live in `scratch/` (gitignored, local only).
