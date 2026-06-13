import Papa from "npm:papaparse@5.5.2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import tzLookup from "npm:tz-lookup@6.1.25";
import isoCountries from "npm:i18n-iso-countries@7.14.0";

const COUNTRIES_URL =
  "https://davidmegginson.github.io/ourairports-data/countries.csv";
const AIRPORTS_URL =
  "https://davidmegginson.github.io/ourairports-data/airports.csv";

const UPSERT_BATCH_SIZE = 1_000;
const CONTINENT_CODES = new Set(["NA", "EU", "AS", "AF", "OC", "SA", "AN"]);
const AIRPORT_CITY_OVERRIDES: Record<string, string> = {
  SEN: "London",
  SFO: "San Francisco Bay",
  SJC: "San Francisco Bay",
  OAK: "San Francisco Bay",
  // airports whose municipality is a different locality than the metro they serve
  MXP: "Milan",
  XIY: "Xi'an",
  XNN: "Xining",
  IAD: "Washington", // Dulles sits in Dulles/Sterling VA but serves Washington DC
};

// OurAirports municipalities often carry a "(District)" suffix (e.g. "Shanghai
// (Pudong)"), which splits multi-airport cities. Strip it so they aggregate as one.
const cleanCity = (m: string | null): string | null => (m ? m.replace(/\s*\(.*\)\s*$/, "").trim() || m : m);

type CountryRow = {
  code: string;
  name: string;
  continent: string;
};

type AirportRow = {
  iata_code: string;
  ident: string;
  name: string;
  municipality: string;
  iso_country: string;
  continent: string;
  iso_region: string;
  latitude_deg: string;
  longitude_deg: string;
  icao_code: string;
};

export type RefreshStats = {
  source: "ourairports";
  countries_upserted?: number;
  airports_upserted?: number;
  airports_skipped_missing_iata?: number;
  airports_skipped_invalid?: number;
  country_iso2?: string;
  airport_iata?: string;
};

export async function refreshCountries(
  supabase: SupabaseClient,
  options?: { countryIso2?: string },
): Promise<RefreshStats> {
  const rows = await fetchCsv<CountryRow>(COUNTRIES_URL);
  const targetCountry = options?.countryIso2?.trim().toUpperCase();
  const countryRecords = rows.flatMap((row) => {
    const iso2 = cleanString(row.code)?.toUpperCase();
    const iso3 = iso2 ? isoCountries.alpha2ToAlpha3(iso2) : undefined;
    const name = cleanString(row.name);
    const continent = parseContinent(row.continent);

    if (!iso2 || !iso3 || !name || !continent) {
      return [];
    }

    if (targetCountry && iso2 !== targetCountry) {
      return [];
    }

    return [{
      iso2,
      iso3,
      name,
      continent,
    }];
  });

  await upsertInBatches(
    supabase,
    "countries",
    countryRecords,
    "iso2",
  );

  return {
    source: "ourairports",
    countries_upserted: countryRecords.length,
    country_iso2: targetCountry,
  };
}

export async function refreshAirports(
  supabase: SupabaseClient,
  options?: { airportIata?: string },
): Promise<RefreshStats> {
  const rows = await fetchCsv<AirportRow>(AIRPORTS_URL);
  const targetAirport = options?.airportIata?.trim().toUpperCase();

  const airports: Array<Record<string, unknown>> = [];
  let skippedMissingIata = 0;
  let skippedInvalid = 0;

  for (const row of rows) {
    const iata = cleanString(row.iata_code)?.toUpperCase();
    if (!iata) {
      skippedMissingIata += 1;
      continue;
    }

    if (targetAirport && iata !== targetAirport) {
      continue;
    }

    const country = cleanString(row.iso_country)?.toUpperCase();
    const continent = parseContinent(row.continent);
    const name = cleanString(row.name);
    const city = AIRPORT_CITY_OVERRIDES[iata] ??
      cleanCity(cleanString(row.municipality)) ?? name;
    const isoRegion = cleanString(row.iso_region);
    const latitude = parseNumber(row.latitude_deg);
    const longitude = parseNumber(row.longitude_deg);
    const icao = cleanString(row.icao_code) ?? cleanString(row.ident);
    // China officially uses Beijing time everywhere (incl. Xinjiang); tz-lookup returns
    // Asia/Urumqi (UTC+6) for the far west, but flights are scheduled/logged in Beijing
    // time, so normalize Chinese airports to Asia/Shanghai for display.
    let timezone = deriveTimezone(latitude, longitude);
    if (timezone === "Asia/Urumqi" && country === "CN") timezone = "Asia/Shanghai";

    if (
      !country || !continent || !name || !city || !isoRegion ||
      latitude === null || longitude === null || !timezone
    ) {
      skippedInvalid += 1;
      continue;
    }

    airports.push({
      iata,
      icao,
      name,
      city,
      country,
      continent,
      iso_region: isoRegion,
      latitude,
      longitude,
      timezone,
    });
  }

  await upsertInBatches(
    supabase,
    "airports",
    airports,
    "iata",
  );

  return {
    source: "ourairports",
    airports_upserted: airports.length,
    airports_skipped_missing_iata: skippedMissingIata,
    airports_skipped_invalid: skippedInvalid,
    airport_iata: targetAirport,
  };
}

async function fetchCsv<T>(url: string): Promise<T[]> {
  const response = await fetch(url, {
    headers: {
      "accept": "text/csv,text/plain;q=0.9,*/*;q=0.8",
      "user-agent": "flightlog-reference-refresh/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const csv = await response.text();
  const parsed = Papa.parse<T>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (value: string) => value.trim(),
    transform: (value: string) => value.trim(),
  });

  if (parsed.errors.length > 0) {
    throw new Error(
      `Failed to parse ${url}: ${parsed.errors[0]?.message ?? "unknown error"}`,
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
  return trimmed.length > 0 ? trimmed : null;
}

function parseContinent(value: unknown): string | null {
  const continent = cleanString(value)?.toUpperCase();
  return continent && CONTINENT_CODES.has(continent) ? continent : null;
}

function parseNumber(value: unknown): number | null {
  const raw = cleanString(value);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveTimezone(
  latitude: number | null,
  longitude: number | null,
): string | null {
  if (latitude === null || longitude === null) {
    return null;
  }

  try {
    return tzLookup(latitude, longitude);
  } catch {
    return null;
  }
}
