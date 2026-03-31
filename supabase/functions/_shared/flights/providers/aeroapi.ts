import { HttpError } from "../http.ts";
import type {
  EnrichFlightRequest,
  EnrichFlightResult,
  FlightInput,
  TrackInput,
} from "../types.ts";

const AEROAPI_BASE = "https://aeroapi.flightaware.com/aeroapi";

type AeroApiFlightOriginDest = {
  code_iata: string;
  code_icao: string;
  timezone: string;
  name: string;
  city: string;
};

type AeroApiFlight = {
  fa_flight_id: string;
  ident_iata: string | null;
  operator_iata: string | null;
  flight_number: string | null;
  registration: string | null;
  aircraft_type: string | null;
  cancelled: boolean;
  blocked: boolean;
  origin: AeroApiFlightOriginDest | null;
  destination: AeroApiFlightOriginDest | null;
  scheduled_out: string | null;
  actual_out: string | null;
  scheduled_off: string | null;
  actual_off: string | null;
  scheduled_on: string | null;
  actual_on: string | null;
  scheduled_in: string | null;
  actual_in: string | null;
};

type AeroApiPosition = {
  latitude: number;
  longitude: number;
  altitude: number;
  groundspeed: number;
  heading: number;
  timestamp: string;
  update_type: string;
};

export function createAeroApiProvider(
  apiKey: string,
): (request: EnrichFlightRequest) => Promise<EnrichFlightResult> {
  return async function (
    request: EnrichFlightRequest,
  ): Promise<EnrichFlightResult> {
    const flightDate = request.flight_date!;
    const ident = buildFlightIdent(request.airline_iata ?? null, request.flight_number!);

    const start = `${flightDate}T00:00:00Z`;
    const end = `${flightDate}T23:59:59Z`;

    const flightsRes = await fetch(
      `${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}?start=${start}&end=${end}&max_pages=1`,
      { headers: { "x-apikey": apiKey } },
    );

    if (flightsRes.status === 404) {
      return notFound();
    }

    if (!flightsRes.ok) {
      throw new HttpError(
        502,
        `AeroAPI flights request failed: ${flightsRes.status}`,
      );
    }

    const flightsData = await flightsRes.json() as {
      flights?: AeroApiFlight[];
    };
    const flights = flightsData.flights ?? [];

    const match = pickFlight(
      flights,
      request.dep_iata ?? null,
      request.arr_iata ?? null,
    );
    if (!match) {
      return notFound();
    }

    const warnings: string[] = [];
    const track = await fetchTrack(match.fa_flight_id, apiKey, warnings);

    const flight: FlightInput = {
      flight_date: flightDate,
      airline_iata: match.operator_iata ?? request.airline_iata ?? undefined,
      flight_number: match.flight_number ?? stripAirlinePrefix(request.flight_number!),
      dep_iata: match.origin?.code_iata ?? request.dep_iata ?? undefined,
      arr_iata: match.destination?.code_iata ?? request.arr_iata ?? undefined,
      sched_dep: match.scheduled_out ?? undefined,
      sched_arr: match.scheduled_in ?? undefined,
      actual_dep: match.actual_out ?? null,
      actual_takeoff: match.actual_off ?? null,
      actual_landing: match.actual_on ?? null,
      actual_arr: match.actual_in ?? null,
      aircraft_type_code: match.aircraft_type ?? null,
      registration: match.registration ?? null,
      source: "aeroapi",
      raw_provider: match,
    };

    return { found: true, provider: "aeroapi", flight, track, warnings };
  };
}

async function fetchTrack(
  faFlightId: string,
  apiKey: string,
  warnings: string[],
): Promise<TrackInput | null> {
  const trackRes = await fetch(
    `${AEROAPI_BASE}/flights/${encodeURIComponent(faFlightId)}/track`,
    { headers: { "x-apikey": apiKey } },
  );

  if (!trackRes.ok) {
    warnings.push(
      `AeroAPI track request failed for ${faFlightId}: ${trackRes.status}`,
    );
    return null;
  }

  const trackData = await trackRes.json() as {
    positions?: AeroApiPosition[];
  };
  const positions = trackData.positions ?? [];

  if (positions.length === 0) {
    return null;
  }

  return {
    geojson: {
      type: "LineString",
      coordinates: positions.map((p) => [p.longitude, p.latitude]),
    },
    source: "aeroapi",
    recorded_at: positions[positions.length - 1].timestamp,
  };
}

function pickFlight(
  flights: AeroApiFlight[],
  depIata: string | null,
  arrIata: string | null,
): AeroApiFlight | null {
  if (flights.length === 0) return null;

  if (!depIata && !arrIata) return flights[0];

  const match = flights.find((f) => {
    if (depIata && f.origin?.code_iata !== depIata) return false;
    if (arrIata && f.destination?.code_iata !== arrIata) return false;
    return true;
  });

  return match ?? null;
}

function buildFlightIdent(
  airlineIata: string | null,
  flightNumber: string,
): string {
  if (!airlineIata) return flightNumber;
  const suffix = stripAirlinePrefix(flightNumber);
  return `${airlineIata}${suffix}`;
}

function stripAirlinePrefix(flightNumber: string): string {
  return flightNumber.replace(/^[A-Z]{1,3}/, "");
}

function notFound(): EnrichFlightResult {
  return { found: false, provider: "aeroapi", flight: null, track: null, warnings: [] };
}
