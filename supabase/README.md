# Supabase Setup

This folder contains the current Supabase schema and backend refresh/enrichment
code for the Flight Log app.

## Current Contents

- `migrations/20260328135916_initial_schema.sql` Creates the base schema, enums,
  indexes, triggers, and `v_flights_with_airports`.
- `migrations/20260329200631_reference_refresh_runs.sql` Adds
  `reference_refresh_runs`, the run log table for `refresh-reference-data`.
- `migrations/20260329202210_add_aircraft_type_shape.sql` Adds `body_class` and
  `deck_count` to `aircraft_types`.
- `migrations/20260329203641_relax_airlines_icao_uniqueness.sql` Drops the
  unique constraint on `airlines.icao`.
- `functions/refresh-reference-data/index.ts` Edge Function entrypoint for
  reference-data refreshes.
- `functions/create-flight/index.ts` Edge Function entrypoint for validated
  flight creation, booking persistence, and best-effort aircraft enrichment.
- `functions/update-flight/index.ts` Edge Function entrypoint for validated
  flight edits and manual corrections.
- `functions/delete-flight/index.ts` Edge Function entrypoint for flight
  deletion by id.
- `functions/_shared/reference/*.ts` Source-specific importers and enrichment
  helpers.

## Implemented Reference Sources

- `countries` and `airports` Source: OurAirports CSV downloads.
- `airlines` Source: OpenFlights `airlines.dat`.
- `airlines.alliance` Source: Wikidata SPARQL.
- `aircraft_types` Source: `doc8643.com` scraper.
- `airports.boundary_geojson` Source: Overpass API, fetched on demand per
  airport.
- `aircraft` Source: AeroDataBox RapidAPI lookup by registration. This is not
  part of `refresh-reference-data`; it is an on-demand enrichment helper.

## refresh-reference-data

The deployed function path is:

- `/functions/v1/refresh-reference-data`

The function expects:

- `Authorization: Bearer <EDGE_FUNCTION_SECRET>`

The function is deployed with `--no-verify-jwt` because it uses a custom bearer
secret instead of a Supabase JWT.

### Supported scopes

- `countries` Optional: `country_iso2`
- `airports` Optional: `airport_iata`
- `ourairports` Optional: `country_iso2`, `airport_iata`
- `airlines` Optional: `airline_iata`
- `alliances` Optional: `airline_iata`
- `aircraft_types` Optional: `aircraft_type_code` Optional: `page_from`,
  `page_to`
- `airport_boundaries` Required: `airport_iata`
- `all` Runs `countries`, `airports`, `airlines`, and `alliances` It
  intentionally does not run the full `aircraft_types` scrape because that
  exceeds hosted worker limits.

### Responses

The function returns:

- `ok`
- `scope`
- `status` One of `success`, `partial_success`, `failed`
- `steps` Per-step results with either `stats` or `error`

Every invocation is also logged to `reference_refresh_runs`.

## create-flight

The deployed function path is:

- `/functions/v1/create-flight`

The function expects:

- `Authorization: Bearer <EDGE_FUNCTION_SECRET>`
- `Content-Type: application/json`

The function is also deployed with `--no-verify-jwt` because it uses the same
custom bearer secret as the other backend entrypoints.

### Responsibilities

- validate and normalize the incoming flight payload
- enforce suffix-only `flight_number` storage
- create or upsert an optional linked `bookings` row
- ensure referenced `airports`, `airlines`, and `aircraft_types` exist, using
  targeted refreshes before failing
- precompute `distance_mi` from airport coordinates
- best-effort fetch and cache `aircraft` metadata by registration
- return the created row from `v_flights_with_airports`

### Response shape

The function returns:

- `ok`
- `flight` The inserted denormalized row from `v_flights_with_airports`
- `warnings` Non-fatal enrichment warnings, such as aircraft lookup failures

## update-flight

The deployed function path is:

- `/functions/v1/update-flight`

The function expects:

- `Authorization: Bearer <EDGE_FUNCTION_SECRET>`
- `Content-Type: application/json`

### Responsibilities

- require a flight `id`
- merge incoming changes over the existing row
- re-run the same validation and reference-resolution logic as `create-flight`
- allow booking changes via: `booking` omitted keeps the existing booking,
  `booking: null` clears `booking_id`, and a booking object creates or updates
  the linked booking
- return the updated row from `v_flights_with_airports`

## delete-flight

The deployed function path is:

- `/functions/v1/delete-flight`

The function expects:

- `Authorization: Bearer <EDGE_FUNCTION_SECRET>`
- `Content-Type: application/json`

### Responsibilities

- require a flight `id`
- delete the underlying `flights` row
- return the deleted denormalized row from `v_flights_with_airports`

## aircraft_types chunking

Full `aircraft_types` refresh is chunked by page range because the full scrape
is too heavy for one hosted edge worker execution.

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

- `EDGE_FUNCTION_SECRET` Required by `refresh-reference-data`.
- `AERODATABOX_RAPIDAPI_KEY` Required by the on-demand `aircraft` lookup module.

The function also relies on Supabase-provided runtime env vars:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Operational Notes

- `refresh-reference-data` is idempotent for the core reference tables.
  Re-running the same scope should update existing rows and insert missing ones,
  not create duplicates.
- `airport_boundaries` is best-effort and fetched separately from the quarterly
  baseline refresh because Overpass can be slow or flaky.
- `aircraft` enrichment is intentionally separate from `refresh-reference-data`
  because it is registration-specific and credit-limited.
- The function code is structured to allow local request-path testing with an
  injected fake Supabase client.

## Typical Commands

Apply schema changes:

```bash
supabase db push
```

Deploy the refresh function:

```bash
supabase functions deploy refresh-reference-data --no-verify-jwt
```

Deploy the create-flight function:

```bash
supabase functions deploy create-flight --no-verify-jwt
```

Deploy the update-flight function:

```bash
supabase functions deploy update-flight --no-verify-jwt
```

Deploy the delete-flight function:

```bash
supabase functions deploy delete-flight --no-verify-jwt
```

Run the baseline hosted refresh:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/refresh-reference-data" \
  -H "Authorization: Bearer $EDGE_FUNCTION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"scope":"all"}'
```

## Quarterly scheduling

Quarterly scheduling is defined in:

- `migrations/20260330193000_schedule_reference_refresh_jobs.sql`

The migration creates:

- a helper function `public.invoke_refresh_reference_data(jsonb)`
- a helper function `public.sync_reference_refresh_schedule(...)` that rebuilds
  the cron jobs
- one quarterly baseline job for `{"scope":"all"}`
- generated staggered quarterly `aircraft_types` chunk jobs up to a configured
  max page

The quarterly jobs run on January 1, April 1, July 1, and October 1 in UTC,
starting at `03:00 UTC` for the baseline refresh and then every 5 minutes for
the `aircraft_types` chunks. The migration currently seeds that schedule with:

- `max_aircraft_type_page = 100`
- `aircraft_type_chunk_size = 5`
- `aircraft_type_interval_minutes = 5`

If `doc8643` grows, you can regenerate the jobs without editing the migration by
running:

```sql
select public.sync_reference_refresh_schedule(150, 5, 5);
```

Before applying that migration in a hosted project, add these Vault secrets:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<EDGE_FUNCTION_SECRET>', 'edge_function_secret');
```

The migration does not attempt to create the `vault` extension. It assumes the
hosted project already exposes the `vault` schema/functions used above.

You can inspect or troubleshoot scheduled runs with:

```sql
select jobname, schedule, active
from cron.job
order by jobname;

select *
from cron.job_run_details
order by start_time desc
limit 20;
```
