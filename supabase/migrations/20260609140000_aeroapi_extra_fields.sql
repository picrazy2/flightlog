-- Extra per-flight fields captured from AeroAPI: terminals, gates, runways, the
-- actual filed route distance, and diversion/status.
alter table public.flights
  add column if not exists terminal_origin text,
  add column if not exists terminal_destination text,
  add column if not exists gate_origin text,
  add column if not exists gate_destination text,
  add column if not exists actual_runway_off text,
  add column if not exists actual_runway_on text,
  add column if not exists route_distance_mi numeric(10, 2),
  add column if not exists diverted boolean,
  add column if not exists provider_status text;

-- Recreate the view so f.* picks up the new columns (the column list is frozen at
-- view-creation time). Identical definition to the segment-cost migration otherwise.
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
left join public.tracks t
  on f.id = t.flight_id
left join public.bookings b
  on f.booking_id = b.id;
