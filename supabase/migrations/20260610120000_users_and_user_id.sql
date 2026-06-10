-- Multi-user scaffolding: a users table mapping a short id → display name, and a
-- user_id on flights so the header can switch between people's logs. Today there's
-- only one user (alex → Alex Guo); existing flights backfill to 'alex'.
create table if not exists public.users (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

insert into public.users (id, name) values ('alex', 'Alex Guo')
on conflict (id) do nothing;

grant select on public.users to anon, authenticated;

alter table public.flights
  add column if not exists user_id text not null default 'alex' references public.users(id);

create index if not exists flights_user_id_idx on public.flights (user_id);

-- Recreate the view (atomic in a txn) so f.* exposes user_id. Body is the latest
-- definition (provider wheels + emails) plus nothing dropped.
drop view if exists public.v_flights_with_airports;

create view public.v_flights_with_airports as
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
  at.body_class as aircraft_type_body_class,
  at.deck_count as aircraft_type_deck_count,
  at.image_url as aircraft_type_image_url,
  ac.year_manufactured,
  ac.country_of_registration,
  (t.flight_id is not null) as has_track,
  t.source as track_source,
  t.recorded_at as track_recorded_at,
  b.booking_refs_airline,
  b.booking_ref_platform,
  b.booking_platform,
  b.cost_cash,
  b.cost_currency,
  b.cost_points,
  b.points_program,
  b.emails
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
left join public.tracks t
  on f.id = t.flight_id
left join public.bookings b
  on f.booking_id = b.id;

grant select on public.v_flights_with_airports to anon, authenticated;
