import { HttpError } from "./http.ts";
import {
  type BookingInput,
  CABIN_CLASS_VALUES,
  type CreateLikeFlightRequest,
  FLIGHT_SOURCE_VALUES,
  FLIGHT_STATUS_VALUES,
  type FlightStatus,
  type NormalizedFlightInput,
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
      booking.raw_email !== undefined,
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

  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new HttpError(
        400,
        `booking.booking_refs_airline[${index}] must be an object`,
      );
    }

    const airlineIata = requireCode(
      Reflect.get(item, "airline_iata") as string | undefined,
      `booking.booking_refs_airline[${index}].airline_iata`,
      2,
    );
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

function normalizeCurrency(value: string | null | undefined) {
  const currency = cleanString(value)?.toUpperCase();
  if (!currency) {
    return null;
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new HttpError(400, "booking.cost_currency must be a 3-letter code");
  }

  return currency;
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
