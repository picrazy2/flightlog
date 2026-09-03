import { HttpError } from "./http.ts";
import {
  type BookingInput,
  CABIN_CLASS_VALUES,
  type CreateLikeFlightRequest,
  FLIGHT_SOURCE_VALUES,
  FLIGHT_STATUS_VALUES,
  type FlightStatus,
  type NormalizedFlightInput,
  type NormalizedTrackInput,
  TRACK_SOURCE_VALUES,
  type TrackInput,
} from "./types.ts";

export function normalizeFlightInput(
  request: CreateLikeFlightRequest,
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
  const providerSchedDep = parseOptionalTimestamp(
    request.provider_sched_dep,
    "provider_sched_dep",
  );
  const providerSchedArr = parseOptionalTimestamp(
    request.provider_sched_arr,
    "provider_sched_arr",
  );
  if (
    providerSchedDep && providerSchedArr &&
    providerSchedArr < providerSchedDep
  ) {
    throw new HttpError(
      400,
      "provider_sched_arr must be on or after provider_sched_dep",
    );
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
    user_id: parseOptionalUserId(request.user_id),
    flight_date: flightDate,
    airline_iata: airlineIata,
    flight_number: normalizeFlightNumber(request.flight_number, airlineIata),
    dep_iata: depIata,
    arr_iata: arrIata,
    sched_dep: schedDep,
    sched_arr: schedArr,
    provider_sched_dep: providerSchedDep,
    provider_sched_arr: providerSchedArr,
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

export function normalizeTrackInput(
  track: TrackInput | null | undefined,
): NormalizedTrackInput | null {
  if (track === null || track === undefined) {
    return null;
  }

  if (
    !track.geojson || typeof track.geojson !== "object" ||
    Array.isArray(track.geojson)
  ) {
    throw new HttpError(400, "track.geojson must be a GeoJSON object");
  }

  const source = parseOptionalEnum(
    track.source,
    TRACK_SOURCE_VALUES,
    "track.source",
  );
  if (!source) {
    throw new HttpError(400, "track.source is required");
  }

  return {
    geojson: track.geojson as Record<string, unknown>,
    source,
    recorded_at: requireTimestamp(track.recorded_at, "track.recorded_at"),
  };
}

export function normalizeBookingInput(
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
    user_id: parseOptionalUserId(booking.user_id) ?? defaultUserId,
    booking_refs_airline: bookingRefsAirline,
    booking_ref_platform: cleanString(booking.booking_ref_platform),
    booking_platform: cleanString(booking.booking_platform),
    cost_cash: costCash,
    cost_currency: normalizeCurrency(booking.cost_currency),
    cost_points: costPoints,
    points_program: normalizePointsProgram(booking.points_program),
    emails: Array.isArray(booking.emails) ? booking.emails : [],
  };
}

export function hasBookingPayload(booking: BookingInput) {
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
      booking.emails !== undefined,
  );
}

export function requireUuid(value: string | undefined | null, field: string) {
  const uuid = typeof value === "string" ? value.trim() : "";
  if (
    !uuid ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(uuid)
  ) {
    throw new HttpError(400, `${field} must be a valid UUID`);
  }

  return uuid;
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

  const withoutAirline = cleaned.startsWith(airlineIata)
    ? cleaned.slice(airlineIata.length)
    : cleaned;
  // Strip leading zeros so "0884" and "884" are the same flight (avoids dupes).
  const stripped = withoutAirline.replace(/^0+(?=\d)/, "");

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

  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new HttpError(
        400,
        `booking.booking_refs_airline[${index}] must be an object`,
      );
    }

    // The airline code on a booking reference is decorative — everything downstream
    // (cancellation matching, the import reports) keys off the PNR. Rejecting the whole
    // email over it meant one easyJet confirmation whose code came back as the ICAO
    // "EZY" rather than IATA "U2" failed every run, and because failures are never
    // marked processed it retried and failed every 15 minutes indefinitely. Keep a
    // valid code, drop an unusable one, never throw.
    const rawIata = cleanString(
      Reflect.get(item, "airline_iata") as string | undefined,
    )?.toUpperCase();
    const airlineIata = rawIata && /^[A-Z0-9]{2}$/.test(rawIata) ? rawIata : null;
    const pnr = cleanString(Reflect.get(item, "pnr") as string | undefined);
    if (!pnr) {
      throw new HttpError(
        400,
        `booking.booking_refs_airline[${index}].pnr is required`,
      );
    }

    return {
      airline_iata: airlineIata,
      pnr,
    };
  });
}

// Currency aliases that aren't ISO 4217 (the renminbi is "CNY", but emails and
// the parser often say "RMB"). Map them to the canonical code.
const CURRENCY_ALIASES = new Map<string, string>([
  ["RMB", "CNY"],
]);

function normalizeCurrency(value: string | null | undefined) {
  let currency = cleanString(value)?.toUpperCase();
  if (!currency) {
    return null;
  }

  currency = CURRENCY_ALIASES.get(currency) ?? currency;

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new HttpError(400, "booking.cost_currency must be a 3-letter code");
  }

  return currency;
}

// Loyalty-program aliases → canonical "<carrier>_<program>" slugs, so the same
// program never fragments across rows (e.g. "united_mp"/"MileagePlus" → one key).
const POINTS_PROGRAM_ALIASES = new Map<string, string>([
  ["united_mp", "united_mileageplus"],
  ["mileageplus", "united_mileageplus"],
  ["lifemiles", "avianca_lifemiles"],
  ["aeroplan", "ac_aeroplan"],
  ["avios", "ba_avios"],
  ["virgin_atlantic_flying_club", "virgin_flying_club"],
  ["virgin_points", "virgin_flying_club"],
  ["phoenix_miles", "air_china_phoenix_miles"],
  ["krisflyer", "singapore_krisflyer"],
]);

function normalizePointsProgram(value: string | null | undefined) {
  const program = cleanString(value);
  if (!program) {
    return null;
  }
  const key = program.toLowerCase();
  return POINTS_PROGRAM_ALIASES.get(key) ?? key;
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

  return parsed;
}

function parseOptionalInteger(
  value: number | null | undefined,
  field: string,
) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isInteger(value)) {
    throw new HttpError(400, `${field} must be an integer`);
  }

  return value;
}

// user_id is a short text slug (e.g. "alex"), a FK to public.users(id) — not a UUID.
// Null/blank means "let the flights.user_id column default apply" (see createFlight).
function parseOptionalUserId(value: string | null | undefined) {
  return cleanString(value);
}

function parseOptionalUuid(value: string | null | undefined, field: string) {
  if (value === null || value === undefined || cleanString(value) === null) {
    return null;
  }

  return requireUuid(value, field);
}

function cleanString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
