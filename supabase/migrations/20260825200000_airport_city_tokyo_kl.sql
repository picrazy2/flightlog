-- Two more airports whose OurAirports municipality is the host town rather than the
-- metro the airport serves, so they split off from the city they belong to:
--   NRT "Narita"  -> Tokyo  (HND is already "Tokyo", so the metro was split in two)
--   KUL "Sepang"  -> Kuala Lumpur
--
-- Mirrors AIRPORT_CITY_OVERRIDES in _shared/reference/ourairports.ts. As with
-- 20260816120000, anything corrected here must also exist there or the next quarterly
-- reference refresh (2026-10-01) will overwrite it.

update public.airports set city = 'Tokyo'        where iata = 'NRT';
update public.airports set city = 'Kuala Lumpur' where iata = 'KUL';
