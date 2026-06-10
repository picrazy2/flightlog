-- Bookings keep the full provenance of every email that touched them, not just
-- the original confirmation's message id. A booking may have many emails over
-- its life: the original booking/e-ticket, schedule changes, and a cancellation.
-- Each entry: { message_id, subject, from, date, kind }
--   kind ∈ 'booking' | 'schedule_change' | 'cancellation'
alter table public.bookings
  add column emails jsonb not null default '[]'::jsonb;

alter table public.bookings
  add constraint bookings_emails_array_check
    check (jsonb_typeof(emails) = 'array');

-- Migrate the single raw_email.message_id into the new array as the booking email.
update public.bookings
set emails = jsonb_build_array(
  jsonb_build_object('message_id', raw_email ->> 'message_id', 'kind', 'booking')
)
where raw_email ? 'message_id';

alter table public.bookings
  drop column raw_email;

-- Recreate the view to expose b.emails (and keep the f.* segment columns).
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
