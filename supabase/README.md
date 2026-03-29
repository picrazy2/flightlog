# Supabase Setup

This folder contains the current Supabase schema and backend refresh/enrichment code for
the Flight Log app.

## Current Contents

- `migrations/20260328135916_initial_schema.sql`
  Creates the base schema, enums, indexes, triggers, and `v_flights_with_airports`.
- `migrations/20260329200631_reference_refresh_runs.sql`
  Adds `reference_refresh_runs`, the run log table for `refresh-reference-data`.
- `migrations/20260329202210_add_aircraft_type_shape.sql`
  Adds `body_class` and `deck_count` to `aircraft_types`.
- `migrations/20260329203641_relax_airlines_icao_uniqueness.sql`
  Drops the unique constraint on `airlines.icao`.
- `functions/refresh-reference-data/index.ts`
  Edge Function entrypoint for reference-data refreshes.
- `functions/_shared/reference/*.ts`
  Source-specific importers and enrichment helpers.

## Implemented Reference Sources

- `countries` and `airports`
  Source: OurAirports CSV downloads.
- `airlines`
  Source: OpenFlights `airlines.dat`.
- `airlines.alliance`
  Source: Wikidata SPARQL.
- `aircraft_types`
  Source: `doc8643.com` scraper.
- `airports.boundary_geojson`
  Source: Overpass API, fetched on demand per airport.
- `aircraft`
  Source: AeroDataBox RapidAPI lookup by registration.
  This is not part of `refresh-reference-data`; it is an on-demand enrichment helper.

## refresh-reference-data

The deployed function path is:

- `/functions/v1/refresh-reference-data`

The function expects:

- `Authorization: Bearer <EDGE_FUNCTION_SECRET>`

The function is deployed with `--no-verify-jwt` because it uses a custom bearer secret
instead of a Supabase JWT.

### Supported scopes

- `countries`
  Optional: `country_iso2`
- `airports`
  Optional: `airport_iata`
- `ourairports`
  Optional: `country_iso2`, `airport_iata`
- `airlines`
  Optional: `airline_iata`
- `alliances`
  Optional: `airline_iata`
- `aircraft_types`
  Optional: `aircraft_type_code`
  Optional: `page_from`, `page_to`
- `airport_boundaries`
  Required: `airport_iata`
- `all`
  Runs `countries`, `airports`, `airlines`, and `alliances`
  It intentionally does not run the full `aircraft_types` scrape because that exceeds
  hosted worker limits.

### Responses

The function returns:

- `ok`
- `scope`
- `status`
  One of `success`, `partial_success`, `failed`
- `steps`
  Per-step results with either `stats` or `error`

Every invocation is also logged to `reference_refresh_runs`.

## aircraft_types chunking

Full `aircraft_types` refresh is chunked by page range because the full scrape is too
heavy for one hosted edge worker execution.

Example:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/refresh-reference-data" \
  -H "Authorization: Bearer $EDGE_FUNCTION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"scope":"aircraft_types","page_from":1,"page_to":5}'
```

Repeat for `6-10`, `11-15`, etc.

## Secrets

Current runtime secrets used by this folder:

- `EDGE_FUNCTION_SECRET`
  Required by `refresh-reference-data`.
- `AERODATABOX_RAPIDAPI_KEY`
  Required by the on-demand `aircraft` lookup module.

The function also relies on Supabase-provided runtime env vars:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Operational Notes

- `refresh-reference-data` is idempotent for the core reference tables. Re-running the
  same scope should update existing rows and insert missing ones, not create duplicates.
- `airport_boundaries` is best-effort and fetched separately from the quarterly baseline
  refresh because Overpass can be slow or flaky.
- `aircraft` enrichment is intentionally separate from `refresh-reference-data` because
  it is registration-specific and credit-limited.
- The function code is structured to allow local request-path testing with an injected
  fake Supabase client.

## Typical Commands

Apply schema changes:

```bash
supabase db push
```

Deploy the refresh function:

```bash
supabase functions deploy refresh-reference-data --no-verify-jwt
```

Run the baseline hosted refresh:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/refresh-reference-data" \
  -H "Authorization: Bearer $EDGE_FUNCTION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"scope":"all"}'
```
