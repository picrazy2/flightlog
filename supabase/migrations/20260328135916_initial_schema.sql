create extension if not exists pgcrypto;

create type public.flight_status as enum (
  'scheduled',
  'completed',
  'cancelled'
);

create type public.flight_source as enum (
  'manual',
  'aeroapi',
  'fr24api',
  'csv_import',
  'gmail'
);

create type public.cabin_class as enum (
  'economy',
  'premium_economy',
  'lie_flat_business',
  'recliner_first',
  'international_first'
);

create type public.airline_alliance as enum (
  'star_alliance',
  'skyteam',
  'oneworld'
);

create type public.continent_code as enum (
  'NA',
  'EU',
  'AS',
  'AF',
  'OC',
  'SA',
  'AN'
);

create type public.aircraft_source as enum (
  'aerodatabox',
  'opensky'
);

create type public.track_source as enum (
  'fr24api',
  'aeroapi'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.countries (
  iso2 text primary key,
  iso3 text not null unique,
  name text not null,
  continent public.continent_code not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.airports (
  iata text primary key,
  icao text unique,
  name text not null,
  city text not null,
  country text not null references public.countries (iso2),
  continent public.continent_code not null,
  iso_region text not null,
  latitude double precision not null,
  longitude double precision not null,
  timezone text not null,
  boundary_geojson jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.airlines (
  iata text primary key,
  icao text unique,
  name text not null,
  country text,
  alliance public.airline_alliance,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.aircraft_types (
  code text primary key,
  name text not null,
  manufacturer text,
  family text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.aircraft (
  registration text primary key,
  aircraft_type_code text references public.aircraft_types (code),
  year_manufactured integer,
  country_of_registration text,
  operator_iata text references public.airlines (iata),
  source public.aircraft_source not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aircraft_year_manufactured_check
    check (year_manufactured is null or year_manufactured between 1903 and 2100)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  booking_refs_airline jsonb,
  booking_ref_platform text,
  booking_platform text,
  cost_cash numeric(12, 2),
  cost_currency text,
  cost_points integer,
  points_program text,
  raw_email jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_cost_points_check
    check (cost_points is null or cost_points >= 0),
  constraint bookings_booking_refs_airline_array_check
    check (
      booking_refs_airline is null
      or jsonb_typeof(booking_refs_airline) = 'array'
    )
);

create table public.flights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  flight_date date not null,
  airline_iata text not null references public.airlines (iata),
  flight_number text not null,
  dep_iata text not null references public.airports (iata),
  arr_iata text not null references public.airports (iata),
  sched_dep timestamptz not null,
  sched_arr timestamptz not null,
  actual_dep timestamptz,
  actual_takeoff timestamptz,
  actual_landing timestamptz,
  actual_arr timestamptz,
  aircraft_type_code text references public.aircraft_types (code),
  registration text,
  cabin_class public.cabin_class,
  distance_mi integer,
  booking_id uuid references public.bookings (id) on delete set null,
  status public.flight_status not null default 'scheduled',
  source public.flight_source not null,
  raw_provider jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flights_dep_arr_distinct_check check (dep_iata <> arr_iata),
  constraint flights_sched_order_check check (sched_arr >= sched_dep),
  constraint flights_distance_mi_check
    check (distance_mi is null or distance_mi >= 0)
);

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  flight_id uuid not null references public.flights (id) on delete cascade,
  geojson jsonb not null,
  source public.track_source not null,
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint tracks_geojson_object_check
    check (jsonb_typeof(geojson) = 'object')
);

create table public.sync_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index airports_country_idx
  on public.airports (country);

create index airports_continent_idx
  on public.airports (continent);

create index airports_iso_region_idx
  on public.airports (iso_region);

create index airlines_country_idx
  on public.airlines (country);

create index airlines_alliance_idx
  on public.airlines (alliance);

create index aircraft_aircraft_type_code_idx
  on public.aircraft (aircraft_type_code);

create index aircraft_operator_iata_idx
  on public.aircraft (operator_iata);

create index flights_flight_date_idx
  on public.flights (flight_date desc);

create index flights_sched_arr_idx
  on public.flights (sched_arr desc);

create index flights_airline_iata_idx
  on public.flights (airline_iata);

create index flights_dep_iata_idx
  on public.flights (dep_iata);

create index flights_arr_iata_idx
  on public.flights (arr_iata);

create index flights_aircraft_type_code_idx
  on public.flights (aircraft_type_code);

create index flights_registration_idx
  on public.flights (registration);

create index flights_booking_id_idx
  on public.flights (booking_id);

create unique index flights_identity_unique_idx
  on public.flights (
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    flight_date,
    airline_iata,
    flight_number,
    dep_iata,
    arr_iata
  );

create unique index tracks_flight_id_unique_idx
  on public.tracks (flight_id);

create unique index sync_state_user_key_unique_idx
  on public.sync_state (
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    key
  );

create trigger countries_set_updated_at
before update on public.countries
for each row
execute function public.set_updated_at();

create trigger airports_set_updated_at
before update on public.airports
for each row
execute function public.set_updated_at();

create trigger airlines_set_updated_at
before update on public.airlines
for each row
execute function public.set_updated_at();

create trigger aircraft_types_set_updated_at
before update on public.aircraft_types
for each row
execute function public.set_updated_at();

create trigger aircraft_set_updated_at
before update on public.aircraft
for each row
execute function public.set_updated_at();

create trigger bookings_set_updated_at
before update on public.bookings
for each row
execute function public.set_updated_at();

create trigger flights_set_updated_at
before update on public.flights
for each row
execute function public.set_updated_at();

create trigger tracks_set_updated_at
before update on public.tracks
for each row
execute function public.set_updated_at();

create trigger sync_state_set_updated_at
before update on public.sync_state
for each row
execute function public.set_updated_at();

create or replace view public.v_flights_with_airports as
select
  f.*,
  case
    when dep.country is null or arr.country is null then null
    when dep.country = arr.country then 'domestic'
    else 'international'
  end as trip_type,
  dep.name as dep_name,
  dep.city as dep_city,
  dep.country as dep_country,
  dep.continent as dep_continent,
  dep.latitude as dep_lat,
  dep.longitude as dep_lng,
  dep.timezone as dep_timezone,
  arr.name as arr_name,
  arr.city as arr_city,
  arr.country as arr_country,
  arr.continent as arr_continent,
  arr.latitude as arr_lat,
  arr.longitude as arr_lng,
  arr.timezone as arr_timezone,
  c_dep.name as dep_country_name,
  c_arr.name as arr_country_name,
  al.name as airline_name,
  al.alliance,
  at.name as aircraft_type_name,
  at.manufacturer as aircraft_type_manufacturer,
  at.family as aircraft_type_family,
  at.image_url as aircraft_type_image_url,
  ac.year_manufactured,
  ac.country_of_registration,
  b.booking_refs_airline,
  b.booking_ref_platform,
  b.booking_platform,
  b.cost_cash,
  b.cost_currency,
  b.cost_points,
  b.points_program
from public.flights f
left join public.airports dep
  on f.dep_iata = dep.iata
left join public.airports arr
  on f.arr_iata = arr.iata
left join public.countries c_dep
  on dep.country = c_dep.iso2
left join public.countries c_arr
  on arr.country = c_arr.iso2
left join public.airlines al
  on f.airline_iata = al.iata
left join public.aircraft_types at
  on f.aircraft_type_code = at.code
left join public.aircraft ac
  on f.registration = ac.registration
left join public.bookings b
  on f.booking_id = b.id;
