# Flight Log App — Architecture Decisions

This document is the source of truth for how the app is structured. It is written to be
readable both by humans and by AI agents starting a new session. Decisions are final unless
explicitly marked otherwise. The frontend UI layout and visual design are intentionally
left underspecified here — only the data and infrastructure contracts are defined.

---

## What This Replaces

The current project is a static site driven by a manual pipeline:
`flightlog.csv` → Jupyter notebook → GeoJSON/stats files → `index.html`.

The redesign replaces that with a proper application: real backend, real database,
server-side provider integrations, and a frontend that reads from live data. All legacy
files (notebook, GeoJSON, figures, `index.html`, fonts, exported stats) now live outside
this repo at `/Users/alexanderguo/Documents/github/flightlog-legacy-archive` and are not
part of the new build.

---

## Product Goal

A modern, mobile-friendly personal flight log that:

- lets flights be added, edited, imported, and deleted from the UI,
- enriches flights automatically from external providers and booking confirmation emails,
- supports both future (planned) and historical flights,
- shows route maps and analytics covering at least what the current notebook produces,
- stays cheap for personal use but is structurally ready for multi-user expansion.

---

## Core Principles

- The **frontend** is a rendering layer: it filters, groups, and aggregates data. It does
  not join tables, call providers, or implement business logic.
- The **backend** owns provider integrations, normalization, persistence, scheduled
  refresh, and any operation involving an API key or secret.
- The **database** holds canonical normalized data. One view exposes a fully denormalized
  shape for the frontend to consume.
- The system is cheap now but not painted into a corner for auth, sharing, or iOS later.

---

## Stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Frontend framework | React + Vite, TypeScript | |
| UI components | shadcn/ui + Tailwind CSS | Components are copied into the repo, not a runtime dependency |
| Charts | Recharts | |
| Maps | MapLibre GL JS | |
| Map tiles | OpenFreeMap | Free, no key: `https://tiles.openfreemap.org/styles/liberty` |
| Theme | Dark-first, CSS variables | Light mode extensible via `<html>` class toggle, not required at launch |
| Backend | Supabase | Postgres + Edge Functions + pg_cron |
| Frontend hosting | GitHub Pages | Static build, deployed via GitHub Actions on push to `main` |
| Email parsing AI | Gemini 2.5 Flash | Free tier sufficient; used only for Gmail email parsing |

---

## Repository Structure

```
/
├── src/                  # React frontend (Vite)
├── supabase/
│   ├── migrations/       # SQL migration files
│   └── functions/        # Supabase Edge Functions
├── public/
└── ...config files
```

Legacy files are stored outside the repo at
`/Users/alexanderguo/Documents/github/flightlog-legacy-archive`. They are retained for
reference and migration work, but are excluded from the new build.

---

## Backend Layers

| Layer | Purpose |
|-------|---------|
| **Edge Functions** | Provider calls, write operations, Gmail polling, CSV import, reference data refresh |
| **pg_cron** | Schedules: `refresh-recent` every 60 min, `watch-gmail` every 15–30 min, `refresh-reference-data` quarterly |
| **Postgres triggers** | Auto-update `updated_at` on every row change |
| **Migrations** | Schema, view, indexes |
| **RLS policies** | Per-user data access — added when auth is enabled, not at launch |

---

## Security

**Supabase anon key** — safe to commit to the repo. Used by the frontend for all reads.
Its access is limited to what Postgres permissions allow (and later RLS policies).

**Supabase service role key** — never in the repo or frontend. Used only inside Edge
Functions via Supabase secrets.

**Provider API keys** (FlightAware, FR24, Gemini, Gmail OAuth) — stored in Supabase
secrets. Never exposed to the frontend.

**Edge Function auth (pre-auth)** — all Edge Functions validate an `Authorization: Bearer
<secret>` header. The frontend holds this secret as a build-time environment variable.
Sufficient for a single-user personal app before Supabase Auth is wired up.

---

## Data Flow

1. Frontend loads → fetches all rows from `v_flights_with_airports` via Supabase JS anon
   key → cached by TanStack Query.
2. All stats, charts, and map data are derived in-memory from that cached dataset. The
   global date filter (all-time / year / quarter / custom) is an in-memory array filter.
   No round-trip on filter change.
3. User adds a flight via one of four paths:
   - **Search-assisted**: enter flight number + date (or dep/arr + date) → `enrich-flight`
     Edge Function calls the relevant provider → returns preview → user confirms →
     `create-flight` persists the record.
   - **Manual entry**: user fills in the form directly → `create-flight`.
   - **CSV import**: user uploads a CSV → `import-csv` Edge Function bulk-creates records.
   - **Gmail auto-import**: `watch-gmail` detects a booking confirmation email → Gemini
     parses it → `create-flight` is called automatically.
4. After any write, TanStack Query invalidates the cache and refetches.
5. `refresh-recent` cron job periodically enriches flights that have now landed with
   actuals and track data from FR24.

**Frontend never calls providers directly.** All provider interactions go through Edge
Functions which hold the API keys.

---

## Flight Data Providers

| Need | Provider | Tier | Cost |
|------|----------|------|------|
| Historical backfill (one-time) | FlightAware AeroAPI | Standard | ~$100 (one month, then cancel) |
| Near-future schedule lookup (≤2 days out) | FlightAware AeroAPI | Personal | Free |
| Recent historical actuals (≤30 days) | Flightradar24 API | Explorer | $9/month |

### FlightAware AeroAPI

| Tier | Cost | Rate limit | Historical | Permitted use |
|------|------|-----------|------------|---------------|
| Personal | Free (~$5/month credit) | 10 result sets/min | No | Personal/academic |
| Standard | Per-query, $100/month min | 5 result sets/sec | Yes (back to 2011) | Business/B2C |
| Premium | Per-query, $1,000/month min | 100 result sets/sec | Yes + advanced | B2B |

**Backfill**: subscribe to Standard for one month, run the historical import, cancel. ~$100.

**Future lookups**: Personal tier `GET /flights/{ident}` returns schedules up to 2 days
ahead. For flights booked further out, no affordable API covers 6–12 months (cheapest is
$49/month). Those flights are entered manually — the user already has times from their
booking confirmation, and `refresh-recent` automatically enriches with actuals after landing.

### Flightradar24 API

The FR24 **consumer subscription** (web/mobile app) is a separate product with no API
access. The app uses the **FR24 API** (distinct subscription):

| Tier | Cost | Calls/month | Historical window |
|------|------|-------------|-------------------|
| Explorer | $9/month | 30,000 | 30 days |
| Essential | $99/month | 450,000 | 2 years |
| Advanced | $900/month | 4,050,000 | All |

The app uses Explorer. The 30-day window matches the `refresh-recent` eligibility window.

### Provider routing

| Flight date | Provider called |
|-------------|----------------|
| Future (≤2 days out) | AeroAPI Personal |
| Future (>2 days out) | None — manual entry |
| Past ≤30 days | FR24 API |
| Past >30 days | AeroAPI Standard (backfill period only) or manual |

---

## Reference Data

All reference tables live in Supabase. The frontend queries them directly for autocomplete
(airport/airline search when adding a flight).

| Table | Source | Refresh |
|-------|--------|---------|
| `airports` | OurAirports CSV | Quarterly cron + on-demand if IATA join fails |
| `airlines` | OpenFlights `airlines.dat` | Quarterly cron + targeted on-demand refresh by IATA when airline lookup fails |
| `airlines.alliance` | Wikidata SPARQL | Quarterly cron (same job as airlines) |
| `countries` | OurAirports `countries.csv` | Quarterly cron |
| `aircraft_types` | Scraped from `doc8643.com`, keyed by ICAO aircraft type designator | Quarterly cron in paged batches + on-demand if an aircraft type code is missing |
| `aircraft` | AeroDataBox free tier (600 calls/month, API.Market) | On demand per new registration, cached permanently |
| `airports.boundary_geojson` | OpenStreetMap Overpass API | On demand per airport when first needed, cached permanently |

**On-demand refresh**: if `create-flight` or `import-csv` encounters an IATA code not in
the `airports` table, it triggers `refresh-reference-data` before failing. Same pattern
for airline IATA codes and aircraft type codes. Airport boundaries are fetched through a
separate targeted `refresh-reference-data` scope when a specific airport boundary is
needed, not as part of the quarterly baseline refresh.

**Aircraft type metadata** is normalized into `aircraft_types`, keyed by ICAO aircraft
type designator (e.g. `B77W`, `A20N`), and sourced by scraping `doc8643.com`. The scraper
supports both quarterly full refreshes and on-demand fetches for unknown type codes.
Scrapes are best-effort: if parsing fails or the upstream site is unavailable, the system
logs the failure and retains the current cached table contents rather than deleting or
blocking on the refresh itself.

**Aircraft metadata** (`year_manufactured`, `operator_iata`) comes from AeroDataBox.
**Country of registration** is derived from the tail number prefix via a static ICAO
lookup table bundled with the backend (e.g. N→USA, G→UK, VH→Australia). No API needed.
`aircraft` enrichment is intentionally not part of the quarterly reference-data refresh;
it is resolved on demand by registration from runtime flows such as `create-flight`.

### Static assets (no table needed)

| Asset | Delivery |
|-------|---------|
| Country flags | `https://flagcdn.com/{iso2}.png` — URL constructed at render time, browser-cached |
| Airline logos | `https://images.kiwi.com/airlines/64/{IATA}.png` — same pattern |
| Country GeoJSON boundaries | `world-atlas` npm package (1:50m), bundled with frontend |

---

## Schema

The initial schema uses Postgres enums for genuinely closed sets:

- `flight_status`: `scheduled`, `completed`, `cancelled`
- `flight_source`: `manual`, `aeroapi`, `fr24api`, `csv_import`, `gmail`
- `cabin_class`: `economy`, `premium_economy`, `lie_flat_business`, `recliner_first`, `international_first`
- `airline_alliance`: `star_alliance`, `skyteam`, `oneworld`
- `continent_code`: `NA`, `EU`, `AS`, `AF`, `OC`, `SA`, `AN`
- `aircraft_source`: `aerodatabox`, `opensky`
- `track_source`: `fr24api`, `aeroapi`

`booking_platform`, `iso_region`, and aircraft type codes remain plain text in the
database because those vocabularies are expected to evolve or are already maintained by
external standards.

### `flights`

| Column | Notes |
|--------|-------|
| `id` | |
| `user_id` | Nullable — exists from day one for multi-user migration |
| `flight_date` | |
| `airline_iata` | Required FK → `airlines` |
| `flight_number` | Required numeric/string suffix only, e.g. `123` rather than `UA123` |
| `dep_iata` | Required FK → `airports` |
| `arr_iata` | Required FK → `airports` |
| `sched_dep` | Timestamptz |
| `sched_arr` | Timestamptz |
| `actual_dep` | Gate departure (pushback), nullable |
| `actual_takeoff` | Wheels off, nullable |
| `actual_landing` | Wheels on, nullable |
| `actual_arr` | Gate arrival (blocks on), nullable |
| `aircraft_type_code` | Nullable FK → `aircraft_types`, e.g. `B77W` |
| `registration` | Tail number, nullable text; no FK in v1 because the flight may exist before aircraft enrichment |
| `cabin_class` | Enum: Economy, Premium Economy, Lie-flat Business, Recliner First, International First |
| `distance_mi` | Stored — requires haversine, worth pre-computing once |
| `booking_id` | Nullable FK → `bookings` |
| `status` | Enum: scheduled, completed, cancelled |
| `source` | Enum: manual, aeroapi, fr24api, csv_import, gmail |
| `raw_provider` | JSONB — raw provider response |
| `created_at` | |
| `updated_at` | Auto-updated by Postgres trigger |

All duration, taxi, and delay values (airborne time, gate-to-gate, departure delay, etc.)
are computed by the frontend from the stored timestamps. They are simple subtractions and
compute in under a millisecond for the full dataset.

Connecting flights (multi-leg itineraries) are stored as separate individual `flights`
rows, one per leg, each with its own `booking_id` pointing to the same `bookings` row.

The initial migration includes a duplicate-prevention unique index covering the flight's
core identity: user, date, airline, flight number, and departure/arrival airports.

### `bookings`

One row per booking confirmation. Covers cost and PNR data that apply to one or more
flight legs (e.g. a round trip has one cost and one airline PNR but two flight rows).

| Column | Notes |
|--------|-------|
| `id` | |
| `user_id` | Nullable — future-proof for multi-user |
| `booking_refs_airline` | JSONB array of airline PNR objects, nullable; supports multiple airlines on one booking |
| `booking_ref_platform` | OTA confirmation code, nullable — OTAs issue their own code in addition to the airline PNR |
| `booking_platform` | direct, expedia, google_flights, chase_travel, etc., nullable |
| `cost_cash` | Nullable decimal |
| `cost_currency` | Nullable, e.g. USD, GBP |
| `cost_points` | Nullable integer |
| `points_program` | Nullable, e.g. chase_ur, amex_mr, united_mp |
| `raw_email` | JSONB — raw parsed email payload when created via Gmail import |
| `created_at` | |
| `updated_at` | Auto-updated by Postgres trigger |

### `airports`

| Column | Notes |
|--------|-------|
| `iata` | Primary key |
| `icao` | Nullable |
| `name` | |
| `city` | |
| `country` | ISO 2-letter code |
| `continent` | Enum: NA, EU, AS, AF, OC, SA, AN |
| `iso_region` | e.g. US-CA |
| `latitude` | |
| `longitude` | |
| `timezone` | IANA string, e.g. `America/New_York` |
| `boundary_geojson` | JSONB polygon, nullable — fetched from Overpass API on demand |

All columns except `boundary_geojson` come from the OurAirports CSV.

### `airlines`

| Column | Notes |
|--------|-------|
| `iata` | Primary key |
| `icao` | Nullable; not unique because real airline datasets contain collisions |
| `name` | |
| `country` | |
| `alliance` | Enum: star_alliance, skyteam, oneworld, or null |

### `countries`

| Column | Notes |
|--------|-------|
| `iso2` | Primary key |
| `iso3` | |
| `name` | e.g. "United States" |
| `continent` | Enum: NA, EU, AS, AF, OC, SA, AN |

### `aircraft_types`

| Column | Notes |
|--------|-------|
| `code` | Primary key; ICAO aircraft type designator, e.g. `B77W` |
| `name` | Human-readable type name, e.g. "Boeing 777-300ER" |
| `manufacturer` | Nullable |
| `family` | Nullable grouping for charts, e.g. `777`, `A320neo family` |
| `body_class` | Nullable; `narrowbody` or `widebody`, derived heuristically from scraped technical data |
| `deck_count` | `1` or `2`; hardcoded to `2` for `B74x` and `A38x`, otherwise `1` |
| `image_url` | Nullable — optional image for charts or detail views |
| `created_at` | |
| `updated_at` | Auto-updated by Postgres trigger |

### `aircraft`

| Column | Notes |
|--------|-------|
| `registration` | Primary key |
| `aircraft_type_code` | Nullable FK → `aircraft_types` |
| `year_manufactured` | Nullable |
| `country_of_registration` | Derived from ICAO tail prefix table, nullable |
| `operator_iata` | Nullable, FK → `airlines` |
| `source` | Enum: aerodatabox, opensky |
| `fetched_at` | |
| `created_at` | |
| `updated_at` | Auto-updated by Postgres trigger |

### `tracks`

| Column | Notes |
|--------|-------|
| `id` | |
| `flight_id` | FK → `flights`, unique — one current track per flight |
| `geojson` | JSONB LineString |
| `source` | Enum: fr24api, aeroapi |
| `recorded_at` | |
| `updated_at` | Auto-updated by Postgres trigger |

Actual flown paths from providers. Great-circle routes are not stored here — computed
client-side from airport coordinates.

### `sync_state`

| Column | Notes |
|--------|-------|
| `id` | |
| `user_id` | Nullable — future-proof for per-user sync state |
| `key` | e.g. `gmail_last_history_id`, `gmail_processed_ids` |
| `value` | text |
| `created_at` | |
| `updated_at` | |

Used by `watch-gmail` to track polling position and processed message IDs.
Uniqueness is enforced per `(user_id, key)`, using a null-safe index so single-user
pre-auth mode still behaves correctly.

### `reference_refresh_runs`

Persistent run log for `refresh-reference-data`.

| Column | Notes |
|--------|-------|
| `id` | |
| `scope` | Refresh scope invoked, e.g. `all`, `aircraft_types`, `airport_boundaries` |
| `status` | `running`, `success`, `partial_success`, `failed` |
| `request_params` | JSONB request payload passed to the function |
| `results` | JSONB per-step results returned by the function |
| `error_text` | Concatenated error summary for failed steps |
| `started_at` | |
| `finished_at` | Nullable |
| `created_at` | |
| `updated_at` | Auto-updated by Postgres trigger |

---

## The View: `v_flights_with_airports`

The single database view the frontend consumes. Returns one fully denormalized row per
flight — no joins needed by the frontend.

```sql
SELECT
  f.*,
  CASE
    WHEN dep.country IS NULL OR arr.country IS NULL THEN NULL
    WHEN dep.country = arr.country THEN 'domestic'
    ELSE 'international'
  END                    AS trip_type,
  dep.name               AS dep_name,
  dep.city               AS dep_city,
  dep.country            AS dep_country,
  dep.continent          AS dep_continent,
  dep.latitude           AS dep_lat,
  dep.longitude          AS dep_lng,
  dep.timezone           AS dep_timezone,
  arr.name               AS arr_name,
  arr.city               AS arr_city,
  arr.country            AS arr_country,
  arr.continent          AS arr_continent,
  arr.latitude           AS arr_lat,
  arr.longitude          AS arr_lng,
  arr.timezone           AS arr_timezone,
  c_dep.name             AS dep_country_name,
  c_arr.name             AS arr_country_name,
  al.name                AS airline_name,
  al.alliance,
  at.name                AS aircraft_type_name,
  at.manufacturer        AS aircraft_type_manufacturer,
  at.family              AS aircraft_type_family,
  at.body_class          AS aircraft_type_body_class,
  at.deck_count          AS aircraft_type_deck_count,
  at.image_url           AS aircraft_type_image_url,
  ac.year_manufactured,
  ac.country_of_registration,
  b.booking_refs_airline,
  b.booking_ref_platform,
  b.booking_platform,
  b.cost_cash,
  b.cost_currency,
  b.cost_points,
  b.points_program
FROM flights f
LEFT JOIN airports dep       ON f.dep_iata           = dep.iata
LEFT JOIN airports arr       ON f.arr_iata           = arr.iata
LEFT JOIN countries c_dep    ON dep.country          = c_dep.iso2
LEFT JOIN countries c_arr    ON arr.country          = c_arr.iso2
LEFT JOIN airlines al        ON f.airline_iata       = al.iata
LEFT JOIN aircraft_types at  ON f.aircraft_type_code = at.code
LEFT JOIN aircraft ac  ON f.registration = ac.registration
LEFT JOIN bookings b   ON f.booking_id  = b.id
```

The frontend fetches all rows on load, caches with TanStack Query, and applies the global
date filter (all-time / year / quarter / custom) as an in-memory array filter. No database
round-trip on filter change. All stats, charts, and map layers are derived from this
dataset in JavaScript. `LEFT JOIN`s are used intentionally so incomplete reference data
does not hide a flight row from the frontend.

---

## Edge Functions

| Function | Purpose |
|----------|---------|
| `enrich-flight` | Call the relevant provider for a given flight number + date, normalize the result, return a preview payload. **Does not write to the database.** Used for the preview-before-save flow. |
| `create-flight` | Persist a flight record. Accepts manual input or the normalized payload from `enrich-flight`. Also triggers aircraft metadata lookup if the registration is new. |
| `update-flight` | Edit an existing flight record. Supports corrections and manual overrides. |
| `delete-flight` | Remove a flight record. |
| `import-csv` | Bulk-create flights from a CSV upload. |
| `refresh-recent` | Batch job: fetches actuals and track data from FR24 for all eligible recently-landed flights and writes results directly to the DB. Not built on `enrich-flight` — no preview step. |
| `refresh-reference-data` | Refresh `countries`, `airports`, `airlines`, `airline alliances`, and `aircraft_types` from OurAirports, OpenFlights/Wikidata, and `doc8643.com`. Supports targeted scopes for one country, airport, airline, aircraft type, or airport boundary. Logs every run to `reference_refresh_runs`. Does not touch `aircraft`, which remains an on-demand registration lookup. |
| `watch-gmail` | Poll Gmail for new emails, pre-filter with a Gmail search query, parse matches with Gemini 2.5 Flash, call `create-flight` for confirmed booking emails. |

All Edge Functions validate `Authorization: Bearer <secret>` before executing.

---

## Scheduled Jobs

| Job | Schedule | What it does |
|-----|----------|-------------|
| `refresh-recent` | Every 60 min | Enriches recently-landed flights with FR24 actuals |
| `watch-gmail` | Every 15–30 min | Checks for new booking confirmation emails |
| `refresh-reference-data` | Quarterly | Refreshes countries, airports, airlines, and airline alliances; `aircraft_types` runs in paged batches rather than one monolithic job |

### `refresh-recent` eligibility

A flight is eligible if:
- `sched_arr <= now() - interval '30 minutes'` (should have landed, with buffer)
- `actual_arr IS NULL` (not yet enriched)
- `sched_arr >= now() - interval '30 days'` (within FR24 Explorer window)

Flights outside the 30-day window that were never enriched retain whatever data was
available at entry time and will not be automatically retried.

---

## Email Import (Gmail)

Flight booking confirmation emails are automatically detected and imported.

1. `watch-gmail` polls Gmail using a stored cursor (`gmail_last_history_id` in
   `sync_state`). `gmail_processed_ids` prevents duplicate processing if runs overlap.
2. A Gmail search pre-filter narrows to plausible booking emails before any AI call:
   `subject:(confirmation OR itinerary OR "e-ticket" OR booking) AND (flight OR airline)`
3. Matching emails are sent to **Gemini 2.5 Flash** with a structured extraction prompt.
   Gemini returns airline IATA, flight number, date, dep/arr IATA, scheduled times, and
   cabin class — or null if not a flight confirmation.
4. Valid results call `create-flight`. The booking cost/PNR fields are also extracted from
   the email and stored in `bookings`.
5. Airline and airport fields are resolved from the local tables — Gemini only returns
   codes.

A **"Check email now"** button in the UI triggers `watch-gmail` on demand. Same function,
same logic.

Gmail access uses a one-time OAuth flow. The refresh token is stored in Supabase secrets
and never exposed to the frontend.

Gemini is used only for email parsing. No other part of the app calls an AI API.

---

## Map Requirements

MapLibre GL JS with OpenFreeMap tiles. Required at launch:

- Basemap
- Airport markers
- Route lines (great-circle by default, actual track when available)
- Route hover and selection
- Great-circle / actual-track toggle
- Airport boundary layer (different styling / more detail inside airport footprint)
- Globe and flat map view toggle

Not required at launch: 3D, cinematic animation, deck.gl.

---

## Auth and Multi-User

Auth is not required at launch. The schema is prepared for it:

- `user_id` is nullable on `flights`, `bookings`, and `sync_state` from day one.
- A single shared table per entity (not one table per user).
- When added: Supabase Auth + Row Level Security policies.

One-table-per-user was explicitly rejected — it makes schema evolution, querying,
maintenance, and permissioning materially worse.

---

## Future Expansion

The stack supports these additions without a fundamental rewrite:

- Supabase Auth and RLS
- Sharing flights with friends
- Comments and social features
- iOS app using the same Supabase backend
- Richer map animation
- More advanced import/export tooling
