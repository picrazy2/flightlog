-- IATA "CN" was reassigned from the defunct Westward Airways to Grand China Air (HNA
-- group), but OpenFlights still carries the old name. The ICAO (WWD) is correct and is
-- what AeroAPI uses. Fix the loaded row; the airlines import has a matching override so a
-- reference refresh keeps it.
update public.airlines set name = 'Grand China Air', icao = 'WWD' where iata = 'CN';
