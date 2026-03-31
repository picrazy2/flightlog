import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const AERODATABOX_HOST = "aerodatabox.p.rapidapi.com";
const AERODATABOX_BASE_URL = `https://${AERODATABOX_HOST}`;
const MAX_RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = 500;

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
  dependencies: AircraftRequestDependencies = {},
): Promise<AircraftRefreshStats> {
  const normalizedRegistration = normalizeRegistration(registration);
  if (!normalizedRegistration) {
    throw new Error(`Invalid registration: ${registration}`);
  }

  const aircraft = await fetchAircraftResponse(
    normalizedRegistration,
    dependencies,
  );

  if (!aircraft) {
    throw new Error(`Aircraft not found for registration ${normalizedRegistration}`);
  }

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
  dependencies: AircraftRequestDependencies = {},
) {
  const normalizedRegistration = normalizeRegistration(registration);
  if (!normalizedRegistration) {
    throw new Error(`Invalid registration: ${registration}`);
  }

  const aircraft = await fetchAircraftResponse(normalizedRegistration, dependencies);
  return aircraft ? normalizeAircraftRow(aircraft, normalizedRegistration) : null;
}

type AircraftRequestDependencies = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  apiKey?: string;
};

async function fetchAircraftResponse(
  normalizedRegistration: string,
  dependencies: AircraftRequestDependencies,
) {
  const fetchImpl = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? defaultSleep;
  const apiKey = dependencies.apiKey ?? getRequiredEnv("AERODATABOX_RAPIDAPI_KEY");

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const response = await fetchImpl(
      `${AERODATABOX_BASE_URL}/aircrafts/reg/${encodeURIComponent(normalizedRegistration)}`,
      {
        headers: {
          "x-rapidapi-host": AERODATABOX_HOST,
          "x-rapidapi-key": apiKey,
          "accept": "application/json",
        },
      },
    );

    if (response.status === 204 || response.status === 404) {
      return null;
    }

    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      await sleep(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
      continue;
    }

    if (!response.ok) {
      throw new Error(await buildAircraftFetchError(normalizedRegistration, response));
    }

    const bodyText = await response.text();
    if (!bodyText.trim()) {
      return null;
    }

    let aircraft: AeroDataBoxAircraftResponse;
    try {
      aircraft = JSON.parse(bodyText) as AeroDataBoxAircraftResponse;
    } catch {
      throw new Error(
        `Invalid aircraft response for ${normalizedRegistration}: expected JSON body`,
      );
    }

    return aircraft;
  }

  throw new Error(`Failed to fetch aircraft ${normalizedRegistration}: 429`);
}

async function buildAircraftFetchError(
  normalizedRegistration: string,
  response: Response,
) {
  if (response.status === 403) {
    return `Aircraft access denied for ${normalizedRegistration}: 403`;
  }

  if (response.status === 429) {
    return `Aircraft rate limited for ${normalizedRegistration}: 429`;
  }

  const bodyText = await response.text();
  const detail = bodyText.trim().slice(0, 120);

  return detail
    ? `Failed to fetch aircraft ${normalizedRegistration}: ${response.status} ${detail}`
    : `Failed to fetch aircraft ${normalizedRegistration}: ${response.status}`;
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

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
