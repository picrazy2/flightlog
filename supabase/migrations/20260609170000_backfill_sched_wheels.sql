-- Backfill scheduled wheels times from the already-stored raw AeroAPI payload
-- (scheduled_off / scheduled_on) — no provider re-query needed.
update public.flights
set provider_sched_takeoff = (raw_provider->>'scheduled_off')::timestamptz,
    provider_sched_landing = (raw_provider->>'scheduled_on')::timestamptz
where raw_provider is not null
  and (raw_provider->>'scheduled_off') is not null;
