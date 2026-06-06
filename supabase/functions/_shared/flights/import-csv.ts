import Papa from "npm:papaparse@5.5.2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { DateTime } from "npm:luxon@3.7.2";

import { HttpError } from "./http.ts";
import { normalizeFlightInput } from "./normalize.ts";
import { refreshRecentFlights } from "./refresh-recent.ts";
import { createFlight, updateFlight } from "./service.ts";
import {
  ensureAircraftTypeExists,
  ensureAirlineExists,
  ensureAirportsExist,
} from "./references.ts";
import type {
  EnrichFlightResult,
  FlightInput,
  FlightSource,
  ImportCsvRequest,
  ImportCsvResult,
  ImportCsvRowResult,
  ImportCsvDuplicateMode,
  ImportCsvEnrichmentMode,
  StoredFlightRow,
} from "./types.ts";
import {
  IMPORT_CSV_DUPLICATE_MODE_VALUES,
  IMPORT_CSV_ENRICHMENT_MODE_VALUES,
} from "./types.ts";

const REQUIRED_COLUMNS = [
  "date",
  "scheduled_dep_time_local",
  "scheduled_arr_time_local",
  "airline",
  "flight",
  "dep_airport",
  "arr_airport",
] as const;

const HEADER_ALIASES = new Map<string, string>([
  ["date", "date"],
  ["flightdate", "date"],
  ["scheduleddeptimelocal", "scheduled_dep_time_local"],
  ["scheduledarrtimelocal", "scheduled_arr_time_local"],
  ["actualdeptimelocal", "actual_dep_time_local"],
  ["actualarrtimelocal", "actual_arr_time_local"],
  ["actualtakeofftimelocal", "actual_takeoff_time_local"],
  ["actuallandingtimelocal", "actual_landing_time_local"],
  ["airline", "airline"],
  ["flight", "flight"],
  ["depairport", "dep_airport"],
  ["arrairport", "arr_airport"],
  ["class", "class"],
  ["cabinclass", "class"],
  ["aircraft", "aircraft"],
  ["aircrafttype", "aircraft"],
  ["registration", "registration"],
]);

const CABIN_CLASS_ALIASES = new Map<string, FlightInput["cabin_class"]>([
  ["economy", "economy"],
  ["premiumeconomy", "premium_economy"],
  ["premium", "premium_economy"],
  ["premiumecon", "premium_economy"],
  ["premiumeconomyclass", "premium_economy"],
  ["business", "lie_flat_business"],
  ["lieflatbusiness", "lie_flat_business"],
  ["businessclass", "lie_flat_business"],
  ["first", "recliner_first"],
  ["reclinerfirst", "recliner_first"],
  ["internationalfirst", "international_first"],
  ["firstclass", "international_first"],
]);

type CanonicalCsvRow = Record<string, string>;

type AirportInfo = {
  iata: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

type AirlineInfo = {
  iata: string;
  name: string | null;
};

type AircraftTypeInfo = {
  code: string;
  name: string | null;
};

export async function importCsvFlights(
  supabase: SupabaseClient,
  request: ImportCsvRequest,
  dependencies: {
    enrichFlight?: (
      request: FlightInput,
    ) => Promise<EnrichFlightResult>;
    now?: Date;
  } = {},
): Promise<ImportCsvResult> {
  const csvText = extractCsvText(request);
  const duplicateMode = parseDuplicateMode(request.duplicate_mode);
  const enrichmentMode = parseImportEnrichmentMode(request.enrichment_mode);
  const userId = request.user_id ?? null;
  const rows = parseCsvRows(csvText);
  const results: ImportCsvRowResult[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 2;

    try {
      const mapped = await mapCsvRowToFlightInput(
        supabase,
        rows[index],
        userId,
      );
      const existing = await loadExistingFlightByIdentity(supabase, mapped);

      if (!existing) {
        const created = await createFlight(supabase, {
          flight: mapped,
          enrichment_mode: "none",
        });
        results.push({
          row_number: rowNumber,
          outcome: "created",
          flight_id: String(created.flight.id),
          warnings: created.warnings,
        });
        continue;
      }

      if (duplicateMode === "skip") {
        results.push({
          row_number: rowNumber,
          outcome: "skipped",
          flight_id: existing.id,
          warnings: [],
        });
        continue;
      }

      const updatePayload = buildDuplicateUpdatePayload(
        existing,
        mapped,
        duplicateMode,
      );

      if (Object.keys(updatePayload).length === 0) {
        results.push({
          row_number: rowNumber,
          outcome: "skipped",
          flight_id: existing.id,
          warnings: [],
        });
        continue;
      }

      const updated = await updateFlight(supabase, {
        id: existing.id,
        ...updatePayload,
      });
      results.push({
        row_number: rowNumber,
        outcome: "updated",
        flight_id: String(updated.flight.id),
        warnings: updated.warnings,
      });
    } catch (error) {
      results.push({
        row_number: rowNumber,
        outcome: "failed",
        flight_id: null,
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (enrichmentMode === "refresh_after_import") {
    await refreshImportedFlights(supabase, results, dependencies);
  }

  return {
    rows_total: rows.length,
    created: countImportOutcome(results, "created"),
    updated: countImportOutcome(results, "updated"),
    skipped: countImportOutcome(results, "skipped"),
    failed: countImportOutcome(results, "failed"),
    refreshed: results.filter((result) => result.refresh_outcome === "refreshed")
      .length,
    results,
  };
}

function extractCsvText(request: ImportCsvRequest) {
  const csvText = typeof request.csv_text === "string" ? request.csv_text : "";
  if (!csvText.trim()) {
    throw new HttpError(400, "csv_text is required");
  }

  return csvText;
}

function parseDuplicateMode(
  value: string | null | undefined,
): ImportCsvDuplicateMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return "update_missing";
  }

  if (
    IMPORT_CSV_DUPLICATE_MODE_VALUES.has(
      normalized as ImportCsvDuplicateMode,
    )
  ) {
    return normalized as ImportCsvDuplicateMode;
  }

  throw new HttpError(
    400,
    'duplicate_mode must be "skip", "update_missing", or "overwrite"',
  );
}

function parseImportEnrichmentMode(
  value: string | null | undefined,
): ImportCsvEnrichmentMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return "none";
  }

  if (
    IMPORT_CSV_ENRICHMENT_MODE_VALUES.has(
      normalized as ImportCsvEnrichmentMode,
    )
  ) {
    return normalized as ImportCsvEnrichmentMode;
  }

  throw new HttpError(
    400,
    'enrichment_mode must be "none" or "refresh_after_import"',
  );
}

function parseCsvRows(csvText: string) {
  const seenColumns = new Set<string>();
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (value: string) => {
      const canonical = canonicalizeHeader(value);
      if (canonical) {
        seenColumns.add(canonical);
      }
      return canonical ?? "";
    },
    transform: (value: string) => value.trim(),
  });

  if (parsed.errors.length > 0) {
    throw new HttpError(
      400,
      `Failed to parse CSV: ${parsed.errors[0]?.message ?? "unknown error"}`,
    );
  }

  const missing = REQUIRED_COLUMNS.filter((column) => !seenColumns.has(column));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      `CSV is missing required column(s): ${missing.join(", ")}`,
    );
  }

  return parsed.data.map((row: Record<string, string>) => {
    const canonicalRow: CanonicalCsvRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (!key) {
        continue;
      }

      canonicalRow[key] = typeof value === "string" ? value.trim() : "";
    }
    return canonicalRow;
  });
}

async function mapCsvRowToFlightInput(
  supabase: SupabaseClient,
  row: CanonicalCsvRow,
  userId: string | null,
) {
  const depIata = requireIata(row.dep_airport, "dep_airport");
  const arrIata = requireIata(row.arr_airport, "arr_airport");
  const airports = await ensureAirportInfo(supabase, [depIata, arrIata]);
  const depAirport = requireAirportInfo(airports, depIata);
  const arrAirport = requireAirportInfo(airports, arrIata);
  const flightDate = requireDateOnly(row.date, "date");
  const airlineIata = await resolveAirlineIata(
    supabase,
    row.airline,
    row.flight,
  );
  const flightNumber = row.flight;

  const schedDep = parseLocalTimestamp(
    flightDate,
    requireLocalTime(row.scheduled_dep_time_local, "scheduled_dep_time_local"),
    depAirport.timezone,
    "scheduled_dep_time_local",
  );
  const schedArr = parseArrivalTimestamp(
    flightDate,
    requireLocalTime(row.scheduled_arr_time_local, "scheduled_arr_time_local"),
    arrAirport.timezone,
    schedDep,
    "scheduled_arr_time_local",
  );
  const actualDep = parseOptionalDepartureTimestamp(
    flightDate,
    row.actual_dep_time_local,
    depAirport.timezone,
    schedDep,
    "actual_dep_time_local",
  );
  const actualTakeoff = parseOptionalDepartureTimestamp(
    flightDate,
    row.actual_takeoff_time_local,
    depAirport.timezone,
    actualDep ?? schedDep,
    "actual_takeoff_time_local",
  );
  const arrivalReference = actualTakeoff ?? actualDep ?? schedDep;
  const actualLanding = parseOptionalArrivalTimestamp(
    flightDate,
    row.actual_landing_time_local,
    arrAirport.timezone,
    arrivalReference,
    "actual_landing_time_local",
  );
  const actualArr = parseOptionalArrivalTimestamp(
    flightDate,
    row.actual_arr_time_local,
    arrAirport.timezone,
    actualLanding ?? actualTakeoff ?? actualDep ?? schedDep,
    "actual_arr_time_local",
  );
  const aircraftTypeCode = row.aircraft
    ? await resolveAircraftTypeCode(supabase, row.aircraft)
    : null;

  return normalizeFlightInput({
    user_id: userId,
    flight_date: flightDate,
    airline_iata: airlineIata,
    flight_number: flightNumber,
    dep_iata: depIata,
    arr_iata: arrIata,
    sched_dep: schedDep,
    sched_arr: schedArr,
    actual_dep: actualDep,
    actual_takeoff: actualTakeoff,
    actual_landing: actualLanding,
    actual_arr: actualArr,
    aircraft_type_code: aircraftTypeCode,
    registration: row.registration || null,
    cabin_class: normalizeCabinClass(row.class),
    source: "csv_import",
  });
}

async function ensureAirportInfo(
  supabase: SupabaseClient,
  airportIatas: string[],
) {
  await ensureAirportsExist(supabase, airportIatas);
  const { data, error } = await supabase
    .from("airports")
    .select("iata, latitude, longitude, timezone")
    .in("iata", Array.from(new Set(airportIatas)));

  if (error) {
    throw new HttpError(500, `Failed to load airports: ${error.message}`);
  }

  return new Map(
    (((data ?? []) as AirportInfo[])).map((airport) => [airport.iata, airport]),
  );
}

function requireAirportInfo(
  airports: Map<string, AirportInfo>,
  iata: string,
) {
  const airport = airports.get(iata);
  if (!airport) {
    throw new HttpError(500, `Failed to resolve airport ${iata}`);
  }

  return airport;
}

async function resolveAirlineIata(
  supabase: SupabaseClient,
  airlineValue: string,
  flightValue: string,
) {
  const airlineToken = cleanString(airlineValue);
  const flightToken = cleanString(flightValue)?.toUpperCase().replace(/\s+/g, "");
  const prefixedFlightCode = flightToken?.match(/^([A-Z0-9]{2})([A-Z0-9]{1,8})$/)?.[1] ??
    null;

  if (airlineToken && /^[A-Z0-9]{2}$/i.test(airlineToken)) {
    const airlineIata = airlineToken.toUpperCase();
    await ensureAirlineExists(supabase, airlineIata);
    return airlineIata;
  }

  if (prefixedFlightCode) {
    try {
      await ensureAirlineExists(supabase, prefixedFlightCode);
      return prefixedFlightCode;
    } catch {
      // Fall back to name lookup below.
    }
  }

  const airlineName = cleanString(airlineToken)?.toLowerCase();
  if (!airlineName) {
    throw new HttpError(400, "airline is required");
  }

  const { data, error } = await supabase
    .from("airlines")
    .select("iata, name");

  if (error) {
    throw new HttpError(500, `Failed to load airlines: ${error.message}`);
  }

  const matched = ((data ?? []) as AirlineInfo[]).find((airline) =>
    airline.name?.trim().toLowerCase() === airlineName
  );

  if (!matched) {
    throw new HttpError(
      400,
      `Unknown airline: ${airlineToken ?? flightToken ?? "unknown"}`,
    );
  }

  return matched.iata;
}

async function resolveAircraftTypeCode(
  supabase: SupabaseClient,
  value: string,
) {
  const normalized = cleanString(value)?.toUpperCase();
  if (!normalized) {
    return null;
  }

  if (/^[A-Z0-9]{2,4}$/.test(normalized)) {
    await ensureAircraftTypeExists(supabase, normalized);
    return normalized;
  }

  const { data, error } = await supabase
    .from("aircraft_types")
    .select("code, name");

  if (error) {
    throw new HttpError(500, `Failed to load aircraft types: ${error.message}`);
  }

  const target = normalized.toLowerCase();
  const matched = ((data ?? []) as AircraftTypeInfo[]).find((aircraftType) =>
    aircraftType.name?.trim().toLowerCase() === target
  );

  if (!matched) {
    throw new HttpError(400, `Unknown aircraft type: ${value}`);
  }

  return matched.code;
}

async function loadExistingFlightByIdentity(
  supabase: SupabaseClient,
  flight: FlightInput,
) {
  const { data, error } = await supabase
    .from("flights")
    .select("*")
    .eq("flight_date", flight.flight_date)
    .eq("airline_iata", flight.airline_iata)
    .eq("flight_number", flight.flight_number)
    .eq("dep_iata", flight.dep_iata)
    .eq("arr_iata", flight.arr_iata);

  if (error) {
    throw new HttpError(
      500,
      `Failed to load existing flight: ${error.message}`,
    );
  }

  const matches = ((data ?? []) as StoredFlightRow[]).filter((candidate) =>
    (candidate.user_id ?? null) === (flight.user_id ?? null)
  );

  if (matches.length > 1) {
    throw new HttpError(
      500,
      "Failed to load existing flight: duplicate identity rows found",
    );
  }

  return matches[0] ?? null;
}

function buildDuplicateUpdatePayload(
  existing: StoredFlightRow,
  imported: FlightInput,
  mode: ImportCsvDuplicateMode,
) {
  const payload: Record<string, unknown> = {};
  const fields: Array<keyof FlightInput> = [
    "sched_dep",
    "sched_arr",
    "actual_dep",
    "actual_takeoff",
    "actual_landing",
    "actual_arr",
    "aircraft_type_code",
    "registration",
    "cabin_class",
  ];

  for (const field of fields) {
    const importedValue = imported[field];
    if (importedValue === undefined) {
      continue;
    }

    const existingValue = existing[field as keyof StoredFlightRow];
    if (mode === "overwrite") {
      if (importedValue !== existingValue) {
        payload[field] = importedValue;
      }
      continue;
    }

    if (
      isMissingStoredValue(existingValue) &&
      importedValue !== null &&
      importedValue !== ""
    ) {
      payload[field] = importedValue;
    }
  }

  if (Object.keys(payload).length > 0) {
    payload.status = imported.status;
  }

  return payload;
}

async function refreshImportedFlights(
  supabase: SupabaseClient,
  results: ImportCsvRowResult[],
  dependencies: {
    enrichFlight?: (
      request: FlightInput,
    ) => Promise<EnrichFlightResult>;
    now?: Date;
  },
) {
  for (const result of results) {
    if (
      !result.flight_id ||
      (result.outcome !== "created" && result.outcome !== "updated")
    ) {
      continue;
    }

    const refreshResult = await refreshRecentFlights(
      supabase,
      { flight_id: result.flight_id, limit: 1 },
      {
        enrichFlight: dependencies.enrichFlight,
        now: dependencies.now,
        batchLimit: 1,
      },
    );
    const rowRefresh = refreshResult.results[0];
    if (!rowRefresh) {
      continue;
    }

    result.refresh_outcome = rowRefresh.outcome;
    result.refresh_provider = rowRefresh.provider;
    if (rowRefresh.error) {
      result.warnings.push(rowRefresh.error);
    }
    if (rowRefresh.warnings.length > 0) {
      result.warnings.push(...rowRefresh.warnings);
    }
  }
}

function countImportOutcome(
  results: ImportCsvRowResult[],
  outcome: ImportCsvRowResult["outcome"],
) {
  return results.filter((result) => result.outcome === outcome).length;
}

function canonicalizeHeader(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return HEADER_ALIASES.get(normalized) ?? null;
}

function requireIata(value: string | undefined, field: string) {
  const iata = cleanString(value)?.toUpperCase();
  if (!iata || !/^[A-Z0-9]{3}$/.test(iata)) {
    throw new HttpError(400, `${field} must be a 3-character IATA code`);
  }

  return iata;
}

function requireDateOnly(value: string | undefined, field: string) {
  const date = cleanString(value);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(400, `${field} must be in YYYY-MM-DD format`);
  }

  return date;
}

function requireLocalTime(value: string | undefined, field: string) {
  const time = cleanString(value);
  if (!time || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) {
    throw new HttpError(400, `${field} must be in HH:MM or HH:MM:SS format`);
  }

  return normalizeClockTime(time);
}

function parseOptionalDepartureTimestamp(
  flightDate: string,
  timeValue: string | undefined,
  timezone: string,
  referenceInstant: string,
  field: string,
) {
  const time = cleanString(timeValue);
  if (!time) {
    return null;
  }

  return chooseClosestTimestamp(
    flightDate,
    requireLocalTime(time, field),
    timezone,
    referenceInstant,
    field,
  );
}

function parseOptionalArrivalTimestamp(
  flightDate: string,
  timeValue: string | undefined,
  timezone: string,
  departureInstant: string,
  field: string,
) {
  const time = cleanString(timeValue);
  if (!time) {
    return null;
  }

  return parseArrivalTimestamp(
    flightDate,
    requireLocalTime(time, field),
    timezone,
    departureInstant,
    field,
  );
}

function parseLocalTimestamp(
  date: string,
  time: string,
  timezone: string,
  field: string,
) {
  const parsed = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
  if (!parsed.isValid) {
    throw new HttpError(400, `Invalid ${field}: ${parsed.invalidReason ?? "unknown error"}`);
  }

  return toUtcIso(parsed);
}

function chooseClosestTimestamp(
  flightDate: string,
  time: string,
  timezone: string,
  referenceInstant: string,
  field: string,
) {
  const reference = DateTime.fromISO(referenceInstant, { zone: "utc" });
  if (!reference.isValid) {
    throw new HttpError(400, `Invalid ${field} reference timestamp`);
  }

  const candidates = [0, 1].map((dayOffset) =>
    DateTime.fromISO(`${flightDate}T${time}`, { zone: timezone }).plus({
      days: dayOffset,
    })
  );
  const validCandidates = candidates.filter((candidate) => candidate.isValid);
  if (validCandidates.length === 0) {
    throw new HttpError(400, `Invalid ${field}`);
  }

  const selected = validCandidates.reduce((best, candidate) => {
    const bestDiff = Math.abs(best.toUTC().toMillis() - reference.toMillis());
    const candidateDiff = Math.abs(
      candidate.toUTC().toMillis() - reference.toMillis(),
    );
    return candidateDiff < bestDiff ? candidate : best;
  });

  return toUtcIso(selected);
}

function parseArrivalTimestamp(
  flightDate: string,
  time: string,
  timezone: string,
  departureInstant: string,
  field: string,
) {
  const departure = DateTime.fromISO(departureInstant, { zone: "utc" });
  if (!departure.isValid) {
    throw new HttpError(400, `Invalid ${field} departure reference`);
  }

  const candidates = [0, 1, 2].map((dayOffset) =>
    DateTime.fromISO(`${flightDate}T${time}`, { zone: timezone }).plus({
      days: dayOffset,
    })
  ).filter((candidate) => candidate.isValid);

  const selected = candidates.find((candidate) =>
    candidate.toUTC().toMillis() >= departure.toMillis()
  ) ?? candidates[0];

  if (!selected) {
    throw new HttpError(400, `Invalid ${field}`);
  }

  return toUtcIso(selected);
}

function normalizeCabinClass(value: string | undefined) {
  const normalized = cleanString(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return normalized ? (CABIN_CLASS_ALIASES.get(normalized) ?? null) : null;
}

function normalizeClockTime(value: string) {
  const [hours, minutes, seconds = "00"] = value.split(":");
  return `${hours.padStart(2, "0")}:${minutes}:${seconds}`;
}

function cleanString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isMissingStoredValue(value: unknown) {
  return value === null || value === undefined || value === "";
}

function toUtcIso(value: DateTime) {
  const iso = value.toUTC().toISO({
    suppressMilliseconds: true,
    includeOffset: true,
  });
  if (!iso) {
    throw new HttpError(400, "Failed to format timestamp");
  }

  return iso.replace(".000Z", "Z");
}
