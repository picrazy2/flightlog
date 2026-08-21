-- Self-hosted airline logos.
--
-- Marks are fetched once during the reference refresh, stored in the `airline-logos`
-- bucket as <IATA>.png, and served from there rather than hotlinking a third-party CDN
-- on every row render.
--
-- logo_treatment records how the mark must be drawn, decided at fetch time by measuring
-- the image's mean luminance against the app surface (#11141c):
--   'color'   — light enough to sit on the dark surface as-is, full brand colour
--   'lighten' — too dark to read (Lufthansa scores 1.08:1, EgyptAir 1.25, LOT 1.33), so
--               the client renders it as a white silhouette. Inverting instead reaches a
--               similar contrast but returns the wrong brand entirely — BA comes out mint
--               green, Lufthansa cream — which reads worse than losing the colour.
--   'none'    — no usable mark; the UI falls back to the IATA code.
-- A flag rather than a baked-in edit so the treatment can change without re-processing
-- and re-uploading every logo.
alter table public.airlines
  add column if not exists logo_treatment text,
  add column if not exists logo_updated_at timestamptz;

alter table public.airlines
  drop constraint if exists airlines_logo_treatment_check;
alter table public.airlines
  add constraint airlines_logo_treatment_check
    check (logo_treatment is null or logo_treatment in ('color', 'lighten', 'none'));

-- Recreate the view so the flight rows carry the treatment alongside the airline name
-- (Postgres freezes a view's column list at creation time).
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
  al.logo_treatment as airline_logo_treatment,
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
