import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const AERODATABOX_HOST = "aerodatabox.p.rapidapi.com";
const AERODATABOX_BASE_URL = `https://${AERODATABOX_HOST}`;

type AeroDataBoxAircraftResponse = {
  reg?: string;
  icaoCode?: string;
  rolloutDate?: string;
  firstFlightDate?: string;
  deliveryDate?: string;
  airlineName?: string;
};

export type AircraftRefreshStats = {
  source: "aerodatabox";
  aircraft_upserted: number;
  registration: string;
};

export async function refreshAircraftByRegistration(
  supabase: SupabaseClient,
  registration: string,
): Promise<AircraftRefreshStats> {
  const normalizedRegistration = normalizeRegistration(registration);
  if (!normalizedRegistration) {
    throw new Error(`Invalid registration: ${registration}`);
  }

  const response = await fetch(
    `${AERODATABOX_BASE_URL}/aircrafts/reg/${encodeURIComponent(normalizedRegistration)}`,
    {
      headers: {
        "x-rapidapi-host": AERODATABOX_HOST,
        "x-rapidapi-key": getRequiredEnv("AERODATABOX_RAPIDAPI_KEY"),
        "accept": "application/json",
      },
    },
  );

  if (response.status === 404) {
    throw new Error(`Aircraft not found for registration ${normalizedRegistration}`);
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch aircraft ${normalizedRegistration}: ${response.status}`,
    );
  }

  const aircraft = await response.json() as AeroDataBoxAircraftResponse;
  const row = normalizeAircraftRow(aircraft, normalizedRegistration);

  const { error } = await supabase
    .from("aircraft")
    .upsert(row, { onConflict: "registration" });

  if (error) {
    throw new Error(`Failed to upsert aircraft ${normalizedRegistration}: ${error.message}`);
  }

  return {
    source: "aerodatabox",
    aircraft_upserted: 1,
    registration: normalizedRegistration,
  };
}

export async function fetchAircraftRecordByRegistration(
  registration: string,
) {
  const normalizedRegistration = normalizeRegistration(registration);
  if (!normalizedRegistration) {
    throw new Error(`Invalid registration: ${registration}`);
  }

  const response = await fetch(
    `${AERODATABOX_BASE_URL}/aircrafts/reg/${encodeURIComponent(normalizedRegistration)}`,
    {
      headers: {
        "x-rapidapi-host": AERODATABOX_HOST,
        "x-rapidapi-key": getRequiredEnv("AERODATABOX_RAPIDAPI_KEY"),
        "accept": "application/json",
      },
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch aircraft ${normalizedRegistration}: ${response.status}`,
    );
  }

  const aircraft = await response.json() as AeroDataBoxAircraftResponse;
  return normalizeAircraftRow(aircraft, normalizedRegistration);
}

function normalizeAircraftRow(
  aircraft: AeroDataBoxAircraftResponse,
  fallbackRegistration: string,
) {
  const registration = normalizeRegistration(aircraft.reg) ?? fallbackRegistration;
  const aircraftTypeCode = cleanString(aircraft.icaoCode)?.toUpperCase() ?? null;
  const yearManufactured = extractYear(
    aircraft.rolloutDate,
    aircraft.firstFlightDate,
    aircraft.deliveryDate,
  );
  const countryOfRegistration = deriveCountryOfRegistration(registration);

  return {
    registration,
    aircraft_type_code: aircraftTypeCode,
    year_manufactured: yearManufactured,
    country_of_registration: countryOfRegistration,
    operator_iata: null,
    source: "aerodatabox",
    fetched_at: new Date().toISOString(),
  };
}

function extractYear(...values: Array<string | undefined>): number | null {
  for (const value of values) {
    const year = value?.slice(0, 4);
    const parsed = year ? Number(year) : NaN;
    if (Number.isInteger(parsed) && parsed >= 1903 && parsed <= 2100) {
      return parsed;
    }
  }

  return null;
}

function deriveCountryOfRegistration(registration: string): string | null {
  const upper = registration.toUpperCase();

  if (upper.startsWith("N")) return "US";
  if (upper.startsWith("G-")) return "GB";
  if (upper.startsWith("VH-")) return "AU";
  if (upper.startsWith("JA")) return "JP";
  if (upper.startsWith("B-")) return "CN";
  if (upper.startsWith("C-")) return "CA";
  if (upper.startsWith("D-")) return "DE";
  if (upper.startsWith("F-")) return "FR";
  if (upper.startsWith("EC-")) return "ES";
  if (upper.startsWith("EI-")) return "IE";
  if (upper.startsWith("HL")) return "KR";
  if (upper.startsWith("9V-")) return "SG";

  return null;
}

function normalizeRegistration(value: unknown): string | null {
  const cleaned = cleanString(value)?.toUpperCase();
  if (!cleaned) {
    return null;
  }

  return cleaned;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}
