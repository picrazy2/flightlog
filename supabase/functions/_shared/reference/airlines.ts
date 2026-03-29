import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import Papa from "npm:papaparse@5.5.2";

const OPENFLIGHTS_AIRLINES_URL =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat";
const UPSERT_BATCH_SIZE = 1_000;

type AirlineRecord = {
  airline_id?: string;
  name?: string;
  alias?: string;
  iata?: string;
  icao?: string;
  callsign?: string;
  country?: string;
  active?: string;
};

export type AirlineRefreshStats = {
  source: "openflights";
  airlines_upserted: number;
  airlines_skipped_missing_iata: number;
  airline_iata?: string;
};

export async function refreshAirlines(
  supabase: SupabaseClient,
  options?: { airlineIata?: string },
): Promise<AirlineRefreshStats> {
  const rows = await fetchAirlineRows();
  const targetAirline = options?.airlineIata?.trim().toUpperCase();
  const airlinesByIata = new Map<string, Record<string, unknown>>();
  let skippedMissingIata = 0;

  for (const row of rows) {
    const iata = cleanCode(row.iata, 2);
    if (!iata) {
      skippedMissingIata += 1;
      continue;
    }

    if (targetAirline && iata !== targetAirline) {
      continue;
    }

    const name = cleanString(row.name);
    if (!name) {
      continue;
    }

    const candidate = {
      iata,
      icao: cleanCode(row.icao, 3),
      name,
      country: cleanString(row.country),
    };

    const existing = airlinesByIata.get(iata);
    if (!existing || isBetterAirlineRecord(candidate, existing)) {
      airlinesByIata.set(iata, candidate);
    }
  }

  const airlines = Array.from(airlinesByIata.values());

  await upsertInBatches(supabase, "airlines", airlines, "iata");

  return {
    source: "openflights",
    airlines_upserted: airlines.length,
    airlines_skipped_missing_iata: skippedMissingIata,
    airline_iata: targetAirline,
  };
}

async function fetchAirlineRows(): Promise<AirlineRecord[]> {
  const response = await fetch(OPENFLIGHTS_AIRLINES_URL, {
    headers: {
      "accept": "text/plain,text/csv;q=0.9,*/*;q=0.8",
      "user-agent": "flightlog-reference-refresh/1.0",
    },
  });

  if (!response.o