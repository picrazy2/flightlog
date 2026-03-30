import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { HttpError } from "./http.ts";
import type { AircraftTypeRow, AirlineRow, AirportRow } from "./types.ts";

export async function ensureAirportsExist(
  supabase: SupabaseClient,
  airportIatas: string[],
) {
  const uniqueIatas = Array.from(new Set(airportIatas));
  let airports = await loadAirportsByIata(supabase, uniqueIatas);
  const missing = uniqueIatas.filter((iata) => !airports.has(iata));

  if (missing.length === 0) {
    return airports;
  }

  const { refreshAirports, refreshCountries } = await import(
    "../reference/ourairports.ts"
  );
  await refreshCountries(supabase);
  for (const iata of missing) {
    await refreshAirports(supabase, { airportIata: iata });
  }

  airports = await loadAirportsByIata(supabase, uniqueIatas);
  const stillMissing = uniqueIatas.filter((iata) => !airports.has(iata));
  if (stillMissing.length > 0) {
    throw new HttpError(
      400,
      `Unknown airport IATA code(s): ${stillMissing.join(", ")}`,
    );
  }

  return airports;
}

export async function ensureAirlineExists(
  supabase: SupabaseClient,
  airlineIata: string,
) {
  if (await loadAirlineByIata(supabase, airlineIata)) {
    return;
  }

  const { refreshAirlines } = await import("../reference/airlines.ts");
  const { refreshAirlineAlliances } = await import("../reference/alliances.ts");
  await refreshAirlines(supabase, { airlineIata });
  await refreshAirlineAlliances(supabase, { airlineIata });

  if (!await loadAirlineByIata(supabase, airlineIata)) {
    throw new HttpError(400, `Unknown airline IATA code: ${airlineIata}`);
  }
}

export async function ensureAircraftTypeExists(
  supabase: SupabaseClient,
  aircraftTypeCode: string,
) {
  if (await loadAircraftTypeByCode(supabase, aircraftTypeCode)) {
    return;
  }

  const { refreshAircraftTypeByCode } = await import(
    "../reference/aircraft-types.ts"
  );
  await refreshAircraftTypeByCode(supabase, aircraftTypeCode);

  if (!await loadAircraftTypeByCode(supabase, aircraftTypeCode)) {
    throw new HttpError(400, `Unknown aircraft type code: ${aircraftTypeCode}`);
  }
}

async function loadAirportsByIata(
  supabase: SupabaseClient,
  airportIatas: string[],
) {
  const { data, error } = await supabase
    .from("airports")
    .select("iata, latitude, longitude")
    .in("iata", airportIatas);

  if (error) {
    throw new HttpError(500, `Failed to load airports: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as AirportRow[]).map((airport) => [airport.iata, airport]),
  );
}

async function loadAirlineByIata(
  supabase: SupabaseClient,
  airlineIata: string,
) {
  const { data, error } = await supabase
    .from("airlines")
    .select("iata")
    .eq("iata", airlineIata)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      `Failed to load airline ${airlineIata}: ${error.message}`,
    );
  }

  return data as AirlineRow | null;
}

async function loadAircraftTypeByCode(
  supabase: SupabaseClient,
  code: string,
) {
  const { data, error } = await supabase
    .from("aircraft_types")
    .select("code")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      `Failed to load aircraft type ${code}: ${error.message}`,
    );
  }

  return data as AircraftTypeRow | null;
}
