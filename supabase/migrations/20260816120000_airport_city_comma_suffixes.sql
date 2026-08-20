-- The 2026-07-01 quarterly reference refresh re-upserted all 9,056 airports and
-- reintroduced a city-naming regression: OurAirports writes some municipalities as
-- "Locality, Region" ("London, Essex", "Nice, Alpes-Maritimes"), and cleanCity() only
-- stripped the parenthetical "(District)" form. That split multi-airport metros --
-- most visibly London, which should have six airports (LHR, LGW, STN, LTN, LCY, SEN)
-- but had STN sitting alone under "London, Essex".
--
-- cleanCity() in _shared/reference/ourairports.ts now strips both forms, so the next
-- quarterly refresh reproduces this. This migration applies the same result to the
-- current rows rather than waiting until 2026-10-01.
--
-- Note this is the durable fix: scratch/scripts/fix-city-names.mjs patched rows
-- directly and was therefore erased by the refresh. Anything corrected here must also
-- exist in ourairports.ts or it will regress again on 2026-10-01.

-- Mirrors cleanCity(): strip "(District)", then ", Region". coalesce guards against a
-- pathological value collapsing to empty.
update public.airports
set city = coalesce(
  nullif(btrim(split_part(btrim(regexp_replace(city, '\s*\(.*\)\s*$', '')), ',', 1)), ''),
  city
)
where city like '%,%' or city like '%(%';

-- Municipalities written district-first, where the comma strip above yields the
-- district rather than the metro. Mirrors AIRPORT_CITY_OVERRIDES.
update public.airports set city = 'Istanbul' where iata = 'SAW'; -- was "Pendik, Istanbul"
update public.airports set city = 'Lyon'     where iata = 'LYN'; -- was "Chassieu, Lyon"
update public.airports set city = 'Denpasar' where iata = 'DPS'; -- was "Kuta, Badung"

-- Metro grouping: airports serving a metro from a different locality.
update public.airports set city = 'London'   where iata = 'LTN'; -- was "Luton, Luton"
update public.airports set city = 'New York' where iata = 'EWR'; -- was "Newark"; joins JFK/LGA
