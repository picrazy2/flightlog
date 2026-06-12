import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import Papa from "npm:papaparse@5.5.2";

const OPENFLIGHTS_AIRLINES_URL =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat";
const UPSERT_BATCH_SIZE = 1_000;

// IATA codes OpenFlights has wrong — the code was reassigned to a newer carrier, or
// the dataset never updated. These corrected name/ICAO values are applied after the
// OpenFlights merge so a reference refresh can't revert them (a wrong ICAO silently
// breaks AeroAPI enrichment — see W9 → WUK). Add a row here whenever you fix one by hand.
const AIRLINE_OVERRIDES: Record<string, { name: string; icao: string }> = {
  A6: { name: "Air Travel Co. Ltd", icao: "OTC" }, // OpenFlights: Air Alps Aviation
  W4: { name: "Wizz Air Malta", icao: "WMT" }, // OpenFlights: Aero Services Executive
  W9: { name: "Wizz Air UK", icao: "WUK" }, // OpenFlights: Abelag Aviation
  XW: { name: "NokScoot", icao: "NCT" }, // OpenFlights: Sky Express
};

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

  // Apply hand-corrected overrides last so they win over (and survive) OpenFlights.
  for (const [iata, override] of Object.entries(AIRLINE_OVERRIDES)) {
    if (targetAirline && iata !== targetAirline) continue;
    const existing = airlinesByIata.get(iata) as { country?: unknown } | undefined;
    airlinesByIata.set(iata, {
      iata,
      icao: override.icao,
      name: override.name,
      country: existing?.country ?? null,
    });
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

  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenFlights airlines.dat: ${response.status}`,
    );
  }

  const raw = await response.text();
  const withHeader =
    "airline_id,name,alias,iata,icao,callsign,country,active\n" + raw;

  const parsed = Papa.parse<AirlineRecord>(withHeader, {
    header: true,
    skipEmptyLines: true,
    transform: (value: string) => value.trim(),
  });

  if (parsed.errors.length > 0) {
    throw new Error(
      `Failed to parse OpenFlights airlines.dat: ${
        parsed.errors[0]?.message ?? "unknown error"
      }`,
    );
  }

  return parsed.data;
}

async function upsertInBatches(
  supabase: SupabaseClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  onConflict: string,
) {
  for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(index, index + UPSERT_BATCH_SIZE);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict });

    if (error) {
      throw new Error(`Failed to upsert ${table}: ${error.message}`);
    }
  }
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "\\N") {
    return null;
  }

  return trimmed;
}

function cleanCode(value: unknown, expectedLength: number): string | null {
  const cleaned = cleanString(value)?.toUpperCase();
  if (!cleaned || cleaned === "\\N" || cleaned.length !== expectedLength) {
    return null;
  }

  return cleaned;
}

function isBetterAirlineRecord(
  candidate: Record<string, unknown>,
  existing: Record<string, unknown>,
): boolean {
  return scoreAirlineRecord(candidate) > scoreAirlineRecord(existing);
}

function scoreAirlineRecord(record: Record<string, unknown>): number {
  let score = 0;
  if (record.icao) score += 2;
  if (record.country) score += 1;
  return score;
}
