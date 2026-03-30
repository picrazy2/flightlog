import { createClient } from "npm:@supabase/supabase-js@2";

import {
  refreshAirports,
  refreshCountries,
} from "../_shared/reference/ourairports.ts";
import { refreshAirlines } from "../_shared/reference/airlines.ts";
import { refreshAirlineAlliances } from "../_shared/reference/alliances.ts";
import { refreshAircraftTypeByCode } from "../_shared/reference/aircraft-types.ts";
import { fetchAircraftRecordByRegistration } from "../_shared/reference/aircraft.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type FlightStatus = "scheduled" | "completed" | "cancelled";
type FlightSource = "manual" | "aeroapi" | "fr24api" | "csv_import" | "gmail";
type CabinClass =
  | "economy"
  | "premium_economy"
  | "lie_flat_business"
  | "recliner_first"
  | "international_first";

const FLIGHT_STATUS_VALUES = new Set<FlightStatus>([
  "scheduled",
  "completed",
  "cancelled",
]);
const FLIGHT_SOURCE_VALUES = new Set<FlightSource>([
  "manual",
  "aeroapi",
  "fr24api",
  "csv_import",
  "gmail",
]);
const CABIN_CLASS_VALUES = new Set<CabinClass>([
  "economy",
  "premium_economy",
  "lie_flat_business",
  "recliner_first",
  "international_first",
]);

type CreateFlightRequest = {
  user_id?: string | null;
  flight_date?: string;
  airline_iata?: string;
  flight_number?: string;
  dep_iata?: string;
  arr_iata?: string;
  sched_dep?: string;
  sched_arr?: string;
  actual_dep?: string | null;
  actual_takeoff?: string | null;
  actual_landing?: string | null;
  actual_arr?: string | null;
  aircraft_type_code?: string | null;
  registration?: string | null;
  cabin_class?: string | null;
  status?: string | null;
  source?: string | null;
  raw_provider?: unknown;
  booking?: BookingInput | null;
};

type BookingInput = {
  id?: string;
  user_id?: string | null;
  booking_refs_airline?: unknown;
  booking_ref_platform?: string | null;
  booking_platform?: string | null;
  cost_cash?: number | string | null;
  cost_currency?: string | null;
  cost_points?: number | null;
  points_program?: string | null;
  raw_email?: unknown;
};

type AirportRow = {
  iata: string;
  latitude: number;
  longitude: number;
};

type AirlineRow = {
  iata: string;
};

type AircraftTypeRow = {
  code: string;
};

type AircraftRow = {
  registration: string;
  aircraft_type_code: string | null;
  year_manufactured: number | null;
  country_of_registration: string | null;
  operator_iata: string | null;
  source: "aerodatabox" | "opensky";
  fetched_at: string;
};

type NormalizedFlightInput = {
  user_id: string | null;
  flight_date: string;
  airline_iata: string;
  flight_number: string;
  dep_iata: string;
  arr_iata: string;
  sched_dep: string;
  sched_arr: string;
  actual_dep: string | null;
  actual_takeoff: string | null;
  actual_landing: string | null;
  actual_arr: string | null;
  aircraft_type_code: string | null;
  registration: string | null;
  cabin_class: CabinClass | null;
  status: FlightStatus;
  source: FlightSource;
  raw_provider: unknown;
};

type Dependencies = {
  supabase?: ReturnType<typeof createAdminClient>;
};

type CreateFlightResult = {
  ok: true;
  flight: Record<string, unknown>;
  warnings: string[];
};

export async function handleCreateFlightRequest(
  request: Request,
  dependencies?: Dependencies,
) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    requireAuthorizedRequest(request);
    const body = await parseRequest(request);
    const supabase = dependencies?.supabase ?? createAdminClient();
    const warnings: string[] = [];
    const input = normalizeCreateFlightRequest(body);

    const airports = await ensureAirportsExist(
      supabase,
      [input.dep_iata, input.arr_iata],
    );
    await ensureAirlineExists(supabase, input.airline_iata);
    if (input.aircraft_type_code) {
      await ensureAircraftTypeExists(supabase, input.aircraft_type_code);
    }

    const bookingId = await upsertBookingIfPresent(
      supabase,
      body.booking,
      input.user_id,
    );
    const aircraftEnrichment = await maybeEnrichAircraft(
      supabase,
      input.registration,
      input.aircraft_type_code,
      warnings,
    );

    if (!input.aircraft_type_code && aircraftEnrichment.aircraft_type_code) {
      input.aircraft_type_code = aircraftEnrichment.aircraft_type_code;
    }

    const depAirport = airports.get(input.dep_iata);
    const arrAirport = airports.get(input.arr_iata);
    if (!depAirport || !arrAirport) {
      throw new HttpError(500, "Failed to resolve airport coordinates");
    }

    const distanceMi = calculateDistanceMiles(depAirport, arrAirport);
    const row = {
      ...input,
      booking_id: bookingId,
      distance_mi: distanceMi,
    };

    const { data: insertedFlight, error: insertError } = await supabase
      .from("flights")
      .insert(row)
      .select("id")
      .single();

    if (insertError) {
      throw mapSupabaseWriteError(insertError);
    }

    const { data: createdFlight, error: loadError } = await supabase
      .from("v_flights_with_airports")
      .select("*")
      .eq("id", insertedFlight.id)
      .single();

    if (loadError) {
      throw new HttpError(
        500,
        `Failed to load created flight: ${loadError.message}`,
      );
    }

    return jsonResponse<CreateFlightResult>({
      ok: true,
      flight: createdFlight as Record<string, unknown>,
      warnings,
    }, 201);
  } catch (error) {
    const httpError = toHttpError(error);
    return jsonResponse(
      {
        ok: false,
        error: httpError.message,
      },
      httpError.status,
    );
  }
}

if (import.meta.main) {
  Deno.serve((request) => handleCreateFlightRequest(request));
}

async function ensureAirportsExist(
  supabase: ReturnType<typeof createAdminClient>,
  airportIatas: string[],
) {
  const uniqueIatas = Array.from(new Set(airportIatas));
  let airports = await loadAirportsByIata(supabase, uniqueIatas);
  const missing = uniqueIatas.filter((iata) => !airports.has(iata));

  if (missing.length === 0) {
    return airports;
  }

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

async function ensureAirlineExists(
  supabase: ReturnType<typeof createAdminClient>,
  airlineIata: string,
) {
  if (await loadAirlineByIata(supabase, airlineIata)) {
    return;
  }

  await refreshAirlines(supabase, { airlineIata });
  await refreshAirlineAlliances(supabase, { airlineIata });

  if (!await loadAirlineByIata(supabase, airlineIata)) {
    throw new HttpError(400, `Unknown airline IATA code: ${airlineIata}`);
  }
}

async function ensureAircraftTypeExists(
  supabase: ReturnType<typeof createAdminClient>,
  aircraftTypeCode: string,
) {
  if (await loadAircraftTypeByCode(supabase, aircraftTypeCode)) {
    return true;
  }

  await refreshAircraftTypeByCode(supabase, aircraftTypeCode);

  if (!await loadAircraftTypeByCode(supabase, aircraftTypeCode)) {
    throw new HttpError(400, `Unknown aircraft type code: ${aircraftTypeCode}`);
  }

  return true;
}

async function maybeEnrichAircraft(
  supabase: ReturnType<typeof createAdminClient>,
  registration: string | null,
  requestedAircraftTypeCode: string | null,
  warnings: string[],
) {
  if (!registration) {
    return { aircraft_type_code: requestedAircraftTypeCode };
  }

  const { data: existingAircraft, error: existingError } = await supabase
    .from("aircraft")
    .select("registration, aircraft_type_code")
    .eq("registration", registration)
    .maybeSingle();

  if (existingError) {
    throw new HttpError(
      500,
      `Failed to check aircraft cache: ${existingError.message}`,
    );
  }

  if (existingAircraft) {
    return {
      aircraft_type_code: requestedAircraftTypeCode ??
        (existingAircraft.aircraft_type_code as string | null),
    };
  }

  try {
    const aircraftRecord = await fetchAircraftRecordByRegistration(
      registration,
    ) as AircraftRow | null;
    if (!aircraftRecord) {
      warnings.push(
        `Aircraft registration ${registration} was not found in AeroDataBox`,
      );
      return { aircraft_type_code: requestedAircraftTypeCode };
    }

    let aircraftTypeCode = requestedAircraftTypeCode ??
      aircraftRecord.aircraft_type_code;
    if (aircraftTypeCode) {
      try {
        await ensureAircraftTypeExists(supabase, aircraftTypeCode);
      } catch (error) {
        warnings.push(
          `Aircraft type ${aircraftTypeCode} could not be resolved during aircraft enrichment`,
        );
        if (!requestedAircraftTypeCode) {
          aircraftTypeCode = null;
        }
      }
    }

    const { error: upsertError } = await supabase
      .from("aircraft")
      .upsert({
        ...aircraftRecord,
        aircraft_type_code: aircraftTypeCode,
      }, { onConflict: "registration" });

    if (upsertError) {
      warnings.push(
        `Aircraft enrichment for ${registration} could not be cached: ${upsertError.message}`,
      );
      return { aircraft_type_code: requestedAircraftTypeCode };
    }

    return {
      aircraft_type_code: requestedAircraftTypeCode ?? aircraftTypeCode,
    };
  } catch (error) {
    warnings.push(
      `Aircraft enrichment for ${registration} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { aircraft_type_code: requestedAircraftTypeCode };
  }
}

async function upsertBookingIfPresent(
  supabase: ReturnType<typeof createAdminClient>,
  booking: BookingInput | null | undefined,
  defaultUserId: string | null,
) {
  if (!booking || !hasBookingPayload(booking)) {
    return null;
  }

  const row = normalizeBookingInput(booking, defaultUserId);

  if (row.id) {
    const { data, error } = await supabase
      .from("bookings")
      .upsert(row, { onConflict: "id" })
      .select("id")
      .single();

    if (error) {
      throw new HttpError(400, `Failed to upsert booking: ${error.message}`);
    }

    return data.id as string;
  }

  const { data, error } = await supabase
    .from("bookings")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    throw new HttpError(400, `Failed to create booking: ${error.message}`);
  }

  return data.id as string;
}

function normalizeCreateFlightRequest(
  request: CreateFlightRequest,
): NormalizedFlightInput {
  const airlineIata = requireCode(request.airline_iata, "airline_iata", 2);
  const flightDate = requireDateOnly(request.flight_date, "flight_date");
  const depIata = requireCode(request.dep_iata, "dep_iata", 3);
  const arrIata = requireCode(request.arr_iata, "arr_iata", 3);
  if (depIata === arrIata) {
    throw new HttpError(400, "dep_iata and arr_iata must be different");
  }

  const schedDep = requireTimestamp(request.sched_dep, "sched_dep");
  const schedArr = requireTimestamp(request.sched_arr, "sched_arr");
  if (schedArr < schedDep) {
    throw new HttpError(400, "sched_arr must be on or after sched_dep");
  }

  const actualDep = parseOptionalTimestamp(request.actual_dep, "actual_dep");
  const actualTakeoff = parseOptionalTimestamp(
    request.actual_takeoff,
    "actual_takeoff",
  );
  const actualLanding = parseOptionalTimestamp(
    request.actual_landing,
    "actual_landing",
  );
  const actualArr = parseOptionalTimestamp(request.actual_arr, "actual_arr");

  return {
    user_id: parseOptionalUuid(request.user_id, "user_id"),
    flight_date: flightDate,
    airline_iata: airlineIata,
    flight_number: normalizeFlightNumber(request.flight_number, airlineIata),
    dep_iata: depIata,
    arr_iata: arrIata,
    sched_dep: schedDep,
    sched_arr: schedArr,
    actual_dep: actualDep,
    actual_takeoff: actualTakeoff,
    actual_landing: actualLanding,
    actual_arr: actualArr,
    aircraft_type_code: parseOptionalCode(
      request.aircraft_type_code,
      2,
      4,
      "aircraft_type_code",
    ),
    registration: parseOptionalRegistration(request.registration),
    cabin_class: parseOptionalEnum(
      request.cabin_class,
      CABIN_CLASS_VALUES,
      "cabin_class",
    ),
    status: normalizeFlightStatus(request.status, {
      actualDep,
      actualTakeoff,
      actualLanding,
      actualArr,
    }),
    source: parseOptionalEnum(request.source, FLIGHT_SOURCE_VALUES, "source") ??
      "manual",
    raw_provider: request.raw_provider ?? null,
  };
}

function normalizeBookingInput(
  booking: BookingInput,
  defaultUserId: string | null,
) {
  const bookingRefsAirline = normalizeBookingRefsAirline(
    booking.booking_refs_airline,
  );
  const costCash = parseOptionalDecimal(booking.cost_cash, "booking.cost_cash");
  const costPoints = parseOptionalInteger(
    booking.cost_points,
    "booking.cost_points",
  );

  return {
    ...(booking.id ? { id: requireUuid(booking.id, "booking.id") } : {}),
    user_id: parseOptionalUuid(booking.user_id, "booking.user_id") ??
      defaultUserId,
    booking_refs_airline: bookingRefsAirline,
    booking_ref_platform: cleanString(booking.booking_ref_platform),
    booking_platform: cleanString(booking.booking_platform),
    cost_cash: costCash,
    cost_currency: normalizeCurrency(booking.cost_currency),
    cost_points: costPoints,
    points_program: cleanString(booking.points_program),
    raw_email: booking.raw_email ?? null,
  };
}

function hasBookingPayload(booking: BookingInput) {
  return Boolean(
    booking.id ||
      booking.user_id ||
      booking.booking_refs_airline ||
      booking.booking_ref_platform ||
      booking.booking_platform ||
      booking.cost_cash !== undefined ||
      booking.cost_currency ||
      booking.cost_points !== undefined ||
      booking.points_program ||
      booking.raw_email !== undefined,
  );
}

async function loadAirportsByIata(
  supabase: ReturnType<typeof createAdminClient>,
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
  supabase: ReturnType<typeof createAdminClient>,
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
  supabase: ReturnType<typeof createAdminClient>,
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

function calculateDistanceMiles(
  depAirport: AirportRow,
  arrAirport: AirportRow,
) {
  const earthRadiusMiles = 3958.7613;
  const depLat = toRadians(depAirport.latitude);
  const arrLat = toRadians(arrAirport.latitude);
  const deltaLat = toRadians(arrAirport.latitude - depAirport.latitude);
  const deltaLng = toRadians(arrAirport.longitude - depAirport.longitude);

  const haversine = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(depLat) * Math.cos(arrLat) * Math.sin(deltaLng / 2) ** 2;
  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return Math.round(earthRadiusMiles * arc);
}

function toRadians(value: number) {
  return value * (Math.PI / 180);
}

function mapSupabaseWriteError(error: { code?: string; message: string }) {
  if (error.code === "23505") {
    return new HttpError(409, "Flight already exists");
  }

  if (error.code === "23503") {
    return new HttpError(400, `Referenced record is missing: ${error.message}`);
  }

  if (error.code === "23514") {
    return new HttpError(400, `Invalid flight data: ${error.message}`);
  }

  return new HttpError(400, `Failed to create flight: ${error.message}`);
}

function normalizeFlightStatus(
  status: string | null | undefined,
  actuals: {
    actualDep: string | null;
    actualTakeoff: string | null;
    actualLanding: string | null;
    actualArr: string | null;
  },
): FlightStatus {
  const normalized = parseOptionalEnum(status, FLIGHT_STATUS_VALUES, "status");
  if (normalized) {
    return normalized;
  }

  return actuals.actualDep || actuals.actualTakeoff || actuals.actualLanding ||
      actuals.actualArr
    ? "completed"
    : "scheduled";
}

function normalizeFlightNumber(value: string | undefined, airlineIata: string) {
  const cleaned = cleanString(value)?.toUpperCase().replace(/\s+/g, "");
  if (!cleaned) {
    throw new HttpError(400, "flight_number is required");
  }

  const stripped = cleaned.startsWith(airlineIata)
    ? cleaned.slice(airlineIata.length)
    : cleaned;

  if (!/^[A-Z0-9]{1,8}$/.test(stripped)) {
    throw new HttpError(
      400,
      "flight_number must be the numeric/string suffix only, for example 123 rather than UA123",
    );
  }

  return stripped;
}

function requireCode(
  value: string | undefined,
  field: string,
  expectedLength: number,
) {
  const code = cleanString(value)?.toUpperCase();
  if (!code || code.length !== expectedLength || !/^[A-Z0-9]+$/.test(code)) {
    throw new HttpError(
      400,
      `${field} must be a ${expectedLength}-character code`,
    );
  }

  return code;
}

function parseOptionalCode(
  value: string | null | undefined,
  minLength: number,
  maxLength: number,
  field: string,
) {
  const code = cleanString(value)?.toUpperCase();
  if (!code) {
    return null;
  }

  if (
    code.length < minLength || code.length > maxLength ||
    !/^[A-Z0-9]+$/.test(code)
  ) {
    throw new HttpError(
      400,
      `${field} must be ${minLength}-${maxLength} uppercase alphanumeric characters`,
    );
  }

  return code;
}

function parseOptionalRegistration(value: string | null | undefined) {
  const registration = cleanString(value)?.toUpperCase();
  return registration ?? null;
}

function requireDateOnly(value: string | undefined, field: string) {
  const raw = cleanString(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, `${field} must be in YYYY-MM-DD format`);
  }

  return raw;
}

function requireTimestamp(value: string | undefined, field: string) {
  const raw = cleanString(value);
  if (!raw) {
    throw new HttpError(400, `${field} is required`);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${field} must be a valid ISO timestamp`);
  }

  return parsed.toISOString();
}

function parseOptionalTimestamp(
  value: string | null | undefined,
  field: string,
) {
  if (value === null || value === undefined) {
    return null;
  }

  return requireTimestamp(value, field);
}

function parseOptionalEnum<T extends string>(
  value: string | null | undefined,
  allowedValues: Set<T>,
  field: string,
) {
  const normalized = cleanString(value)?.toLowerCase() as T | undefined;
  if (!normalized) {
    return null;
  }

  if (!allowedValues.has(normalized)) {
    throw new HttpError(400, `${field} has an unsupported value`);
  }

  return normalized;
}

function normalizeBookingRefsAirline(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new HttpError(400, "booking.booking_refs_airline must be an array");
  }

  return value;
}

function parseOptionalDecimal(
  value: number | string | null | undefined,
  field: string,
) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, `${field} must be numeric`);
  }

  return Number(parsed.toFixed(2));
}

function parseOptionalInteger(
  value: number | null | undefined,
  field: string,
) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${field} must be a non-negative integer`);
  }

  return value;
}

function normalizeCurrency(value: string | null | undefined) {
  const currency = cleanString(value)?.toUpperCase();
  if (!currency) {
    return null;
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new HttpError(
      400,
      "booking.cost_currency must be a 3-letter currency code",
    );
  }

  return currency;
}

function parseOptionalUuid(value: string | null | undefined, field: string) {
  const raw = cleanString(value);
  if (!raw) {
    return null;
  }

  return requireUuid(raw, field);
}

function requireUuid(value: string, field: string) {
  const uuid = cleanString(value);
  if (
    !uuid ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(uuid)
  ) {
    throw new HttpError(400, `${field} must be a valid UUID`);
  }

  return uuid;
}

function cleanString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new HttpError(
      500,
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function requireAuthorizedRequest(request: Request) {
  const expectedToken = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!expectedToken) {
    throw new HttpError(500, "Missing EDGE_FUNCTION_SECRET");
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${expectedToken}`) {
    throw new HttpError(401, "Unauthorized");
  }
}

async function parseRequest(request: Request): Promise<CreateFlightRequest> {
  if (request.method !== "POST") {
    throw new HttpError(405, "Only POST is supported");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(400, "Content-Type must be application/json");
  }

  return await request.json() as CreateFlightRequest;
}

function jsonResponse<T>(payload: T, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function toHttpError(error: unknown) {
  return error instanceof HttpError ? error : new HttpError(
    500,
    error instanceof Error ? error.message : "Unknown error",
  );
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
