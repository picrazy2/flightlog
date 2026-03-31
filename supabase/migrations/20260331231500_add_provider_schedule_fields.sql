alter table public.flights
  add column provider_sched_dep timestamptz,
  add column provider_sched_arr timestamptz;

alter table public.flights
  add constraint flights_provider_sched_order_check
  check (
    provider_sched_dep is null
    or provider_sched_arr is null
    or provider_sched_arr >= provider_sched_dep
  );

update public.flights
set
  provider_sched_dep = sched_dep,
  provider_sched_arr = sched_arr
where source = 'aeroapi'
  and provider_sched_dep is null
  and provider_sched_arr is null;

comment on column public.flights.sched_dep is
  'User-owned or booking-confirmed scheduled departure timestamp.';

comment on column public.flights.sched_arr is
  'User-owned or booking-confirmed scheduled arrival timestamp.';

comment on column public.flights.provider_sched_dep is
  'Provider-reported scheduled departure timestamp from AeroAPI or another enrichment source.';

comment on column public.flights.provider_sched_arr is
  'Provider-reported scheduled arrival timestamp from AeroAPI or another enrichment source.';
