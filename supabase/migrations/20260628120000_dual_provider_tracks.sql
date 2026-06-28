-- Store BOTH provider tracks per flight (FR24 + AeroAPI) instead of one. FR24 is
-- preferred for display/distance; AeroAPI is kept as a second copy. Swap the
-- one-track-per-flight unique(flight_id) for unique(flight_id, source), and make the
-- track-consuming views pick a single preferred track per flight (FR24, else AeroAPI) so
-- the now one-to-many tracks join doesn't duplicate flight rows.

drop index if exists public.tracks_flight_id_unique_idx;
create unique index if not exists tracks_flight_id_source_unique_idx
  on public.tracks (flight_id, source);

-- v_flights_with_airports: identical to the prior definition except the tracks join is now
-- a lateral that returns the single preferred track (fr24api first, then most recent).
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
  b.cost_cash_usd,
  b.emails
from public.flights f
left join public.airports dep on f.dep_iata = dep.iata
left join public.airports arr on f.arr_iata = arr.iata
left join public.countries c_dep on dep.country = c_dep.iso2
left join public.countries c_arr on arr.country = c_arr.iso2
left join public.airlines al on f.airline_iata = al.iata
left join public.aircraft_types at on f.aircraft_type_code = at.code
left join public.aircraft ac on f.registration = ac.registration
left join lateral (
  select tr.flight_id, tr.source, tr.recorded_at
  from public.tracks tr
  where tr.flight_id = f.id
  order by (tr.source <> 'fr24api'), tr.recorded_at desc
  limit 1
) t on true
left join public.bookings b on f.booking_id = b.id;

grant select on public.v_flights_with_airports to anon, authenticated;

-- v_flight_tracks: one preferred track per flight (the frontend joins this onto the map).
drop view if exists public.v_flight_tracks;
create view public.v_flight_tracks as
select distinct on (t.flight_id)
  t.flight_id,
  t.geojson,
  t.source,
  t.recorded_at
from public.tracks t
order by t.flight_id, (t.source <> 'fr24api'), t.recorded_at desc;

grant select on public.v_flight_tracks to anon, authenticated;
