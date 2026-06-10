-- Canonical actual times = WHEELS (actual_takeoff/actual_landing), matching FR24
-- (wheels-only) and AeroAPI. Legacy CSV/manual flights stored wheels in the GATE
-- columns (actual_dep/actual_arr) — move them into the wheels columns. AeroAPI-enriched
-- flights already have wheels populated, so they're skipped (their gate times stay).
update public.flights
set actual_takeoff = actual_dep,
    actual_landing = actual_arr,
    actual_dep = null,
    actual_arr = null
where actual_takeoff is null
  and actual_landing is null
  and (actual_dep is not null or actual_arr is not null);
