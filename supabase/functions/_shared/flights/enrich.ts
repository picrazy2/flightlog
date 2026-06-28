import { HttpError } from "./http.ts";
import type {
  EnrichFlightRequest,
  EnrichFlightResult,
  FlightInput,
  FlightSource,
} from "./types.ts";

type EnrichmentProvider = (
  request: EnrichFlightRequest,
) => Promise<EnrichFlightResult>;

type NormalizedEnrichFlightRequest = {
  flight_date: string;
  airline_iata: string | null;
  airline_icao: string | null;
  flight_number: string;
  dep_iata: string | null;
  arr_iata: string | null;
  sched_dep: string | null;
  source_hint: string | null;
};

type EnrichDependencies = {
  aeroapi?: EnrichmentProvider;
  fr24api?: EnrichmentProvider;
  now?: Date;
  aeroapiStandardBackfillActive?: boolean;
};

export async function enrichFlight(
  request: EnrichFlightRequest | FlightInput,
  dependencies: EnrichDependencies = {},
): Promise<EnrichFlightResult> {
  const normalizedRequest = normalizeEnrichmentRequest(request);
  const provider = selectProviderForFlight(
    normalizedRequest.flight_date,
    dependencies.now ?? new Date(),
    dependencies.aeroapiStandardBackfillActive ?? false,
  );

  if (!provider) {
    return {
      found: false,
      provider: null,
      flight: null,
      track: null,
      warnings: [],
    };
  }

  const providerImpl = provider === "aeroapi"
    ? dependencies.aeroapi
    : dependencies.fr24api;

  if (!providerImpl) {
    return {
      found: false,
      provider,
      flight: null,
      track: null,
      warnings: [`${provider} enrichment provider is not configured`],
    };
  }

  return await providerImpl(normalizedRequest);
}

function normalizeEnrichmentRequest(
  request: EnrichFlightRequest | FlightInput,
): NormalizedEnrichFlightRequest {
  const flightDate = requireDateOnly(request.flight_date, "flight_date");
  const flightNumber = requireFlightNumber(request.flight_number);

  return {
    flight_date: flightDate,
    airline_iata: normalizeCode(request.airline_iata, 2),
    airline_icao: normalizeCode(request.airline_icao, 3),
    flight_number: flightNumber,
    dep_iata: normalizeCode(request.dep_iata, 3),
    arr_iata: normalizeCode(request.arr_iata, 3),
    sched_dep: request.sched_dep ?? null,
    source_hint: "source_hint" in request ? request.source_hint ?? null : null,
  };
}

function selectProviderForFlight(
  flightDate: string,
  now: Date,
  aeroapiStandardBackfillActive: boolean,
): FlightSource | null {
  const startOfTodayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const flightDateUtc = Date.parse(`${flightDate}T00:00:00.000Z`);
  const deltaDays = Math.floor(
    (flightDateUtc - startOfTodayUtc) / (24 * 60 * 60 * 1000),
  );

  if (deltaDays >= 0 && deltaDays <= 2) {
    return "aeroapi";
  }

  if (deltaDays < 0 && deltaDays >= -30) {
    return "fr24api";
  }

  if (deltaDays < -30 && aeroapiStandardBackfillActive) {
    return "aeroapi";
  }

  return null;
}

function requireDateOnly(value: string | undefined, field: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new HttpError(400, `${field} must be in YYYY-MM-DD format`);
  }

  return value.trim();
}

function requireFlightNumber(value: string | undefined) {
  const trimmed = value?.trim().toUpperCase();
  if (!trimmed) {
    throw new HttpError(400, "flight_number is required");
  }

  return trimmed;
}

function normalizeCode(value: string | null | undefined, length: number) {
  const trimmed = value?.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length !== length || !/^[A-Z0-9]+$/.test(trimmed)) {
    throw new HttpError(400, `Expected a ${length}-character code`);
  }

  return trimmed;
}
