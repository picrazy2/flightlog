# Supabase Setup

This folder contains the current Supabase schema and backend code for the Flight Log app.

## Contents

**Migrations:**
- `20260328135916_initial_schema.sql` Base schema, enums, indexes, triggers, `v_flights_with_airports`
- `20260329200631_reference_refresh_runs.sql` Run log table for `refresh-reference-data`
- `20260329202210_add_aircraft_type_shape.sql` `body_class` and `deck_count` on `aircraft_types`
- `20260329203641_relax_airlines_icao_uniqueness.sql` Drops unique constraint on `airlines.icao`
- `20260330193000_schedule_reference_refresh_jobs.sql` Quarterly pg_cron jobs
- `20260330224500_add_track_views.sql` Track metadata on `v_flights_with_airports`, adds `v_flight_tracks`

**Edge Functions:**
- `enrich-flight` Provider-backed flight preview (no DB writes). Used by the frontend search-before-save flow.
- `create-flight` Validated flight creation with optional provider enrichment, booking persistence, and aircraft enrichment.
- `update-flight` Validated flight edits and manual corrections.
- `delete-flight` Flight deletion by id.
- `refresh-reference-data` Refreshes reference tables from OurAirports, OpenFlights, Wikidata, doc8643.

**Shared modules** (`_shared/flights/`): types, normalize, enrich orchestration, service, bookings, references, aircraft enrichment, providers (aeroapi, fr24api).

## Flight Data Providers

Routing is centralized in `_shared/flights/enrich.ts`. Implementations in `_shared/flights/providers/`.

| Flight date | Provider | Tier |
|---|---|---|
| Future ≤2 days | AeroAPI Personal | Free |
| Past ≤30 days | FR24 API | Explorer ($9/mo) |
| Past >30 days | AeroAPI Standard | Not yet subscribed — buy for backfill month then cancel |
| All others | None | — |

**FR24 limitation:** Returns actual wheels-up/down only. No scheduled times, no gate times. Scheduled times for past flights must come from user input or email parsing.

When AeroAPI Standard is purchased, set `aeroapiStandardBackfillActive: true` in the `enrichFlight` deps in both `enrich-flight/index.ts` and `create-flight/index.ts`.

## Secrets

```bash
supabase secrets set EDGE_FUNCTION_SECRET=<secret>
supabase secrets set AEROAPI_KEY=<key>
supabase secrets set FR24_API_KEY=<token>
supabase secrets set AERODATABOX_RAPIDAPI_KEY=<key>
```

Supabase also injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically.

## Deployment

```bash
supabase db push

supabase functions deploy enrich-flight --no-verify-jwt
supabase functions deploy create-flight --no-verify-jwt
supabase functions deploy update-flight --no-verify-jwt
supabase functions deploy delete-flight --no-verify-jwt
supabase functions deploy refresh-reference-data --no-verify-jwt
```

## create-flight: enrichment_mode

| Value | Behaviour |
|---|---|
| `"none"` (default) | Store provided payload only, no provider call |
| `"try_now"` | Call provider and merge result before persisting, unless request already contains enriched data (track present, or `source` is `aeroapi`/`fr24api`) |

## refresh-reference-data scopes

- `all` — countries, airports, airlines, alliances (no aircraft_types, too heavy)
- `countries`, `airports`, `airlines`, `alliances`, `ourairports` — individual tables
- `aircraft_types` — accepts `page_from`/`page_to` for chunking; `aircraft_type_code` for single type
- `airport_boundaries` — requires `airport_iata`

Full `aircraft_types` refresh must be chunked (run page 1-5, 6-10, etc.).

## Quarterly scheduling

Jobs defined in `20260330193000_schedule_reference_refresh_jobs.sql`. Run quarterly (Jan 1, Apr 1, Jul 1, Oct 1 at 03:00 UTC).

Before applying that migration on a hosted project, add Vault secrets:

```sql
select vault.create_secret('https://ihkybryikwlkppqpfnly.supabase.co', 'project_url');
select vault.create_secret('<EDGE_FUNCTION_SECRET>', 'edge_function_secret');
```

Regenerate jobs if `doc8643` grows:

```sql
select public.sync_reference_refresh_schedule(150, 5, 5);
```

Inspect scheduled runs:

```sql
select jobname, schedule, active from cron.job order by jobname;
select * from cron.job_run_details order by start_time desc limit 20;
```
