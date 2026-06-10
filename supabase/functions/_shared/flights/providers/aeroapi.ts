import { HttpError } from "../http.ts";
import type {
  EnrichFlightRequest,
  EnrichFlightResult,
  FlightInput,
  TrackInput,
} from "../types.ts";

const AEROAPI_BASE = "https://aeroapi.flightaware.com/aeroapi";
// The live /flights/{ident} endpoint only accepts start dates up to ~10 days in the
// past; older flights must use the /history/* endpoints (Standard/Premium tiers).
const LIVE_WINDOW_MS = 9 * 24 * 60 * 60 * 1000;
function isHistorical(flightDate: string): boolean {
  const ms = Date.parse(`${flightDate}T00:00:00Z`);
  return !Number.isNaN(ms) && ms < Date.now() - LIVE_WINDOW_MS;
}

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
  terminal_origin: string | null;
  terminal_destination: string | null;
  gate_origin: string | null;
  gate_destination: string | null;
  actual_runway_off: string | null;
  actual_runway_on: string | null;
  route_distance: number | null;
  diverted: boolean;
  status: string | null;
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
    const historical = isHistorical(flightDate);
    const prefix = historical ? "/history" : "";
    // Widen to ±1 day so timezone date-edges (local flight date vs UTC window) match.
    const start = `${addDays(flightDate, -1)}T00:00:00Z`;
    const end = `${addDays(flightDate, 1)}T23:59:59Z`;
    const query = (ident: string) =>
      queryFlights(`${AEROAPI_BASE}${prefix}/flights/${encodeURIComponent(ident)}?start=${start}&end=${end}&max_pages=1`, apiKey);

    // ICAO airline designators are unambiguous (EZY8534); prefer them, but fall back to
    // the IATA ident when ICAO finds nothing (e.g. bad reference-data ICAO).
    const icaoIdent = buildFlightIdent(request.airline_icao ?? null, request.airline_iata ?? null, request.flight_number!);
    const dep = request.dep_iata ?? null;
    const arr = request.arr_iata ?? null;
    let flights = await query(icaoIdent);
    let match = pickFlight(flights, dep, arr, flightDate);
    if (!match && request.airline_iata) {
      const iataIdent = buildFlightIdent(null, request.airline_iata, request.flight_number!);
      if (iataIdent !== icaoIdent) {
        flights = await query(iataIdent);
        match = pickFlight(flights, dep, arr, flightDate);
      }
    }
    if (!match) {
      return notFound();
    }

    const warnings: string[] = [];
    const track = await fetchTrack(match.fa_flight_id, apiKey, warnings, historical);

    const flight: FlightInput = {
      flight_date: flightDate,
      airline_iata: match.operator_iata ?? request.airline_iata ?? undefined,
      flight_number: match.flight_number ?? stripAirlinePrefix(request.flight_number!),
      dep_iata: match.origin?.code_iata ?? request.dep_iata ?? undefined,
      arr_iata: match.destination?.code_iata ?? request.arr_iata ?? undefined,
      provider_sched_dep: match.scheduled_out ?? null,
      provider_sched_arr: match.scheduled_in ?? null,
      provider_sched_takeoff: match.scheduled_off ?? null,
      provider_sched_landing: match.scheduled_on ?? null,
      actual_dep: match.actual_out ?? null,
      actual_takeoff: match.actual_off ?? null,
      actual_landing: match.actual_on ?? null,
      actual_arr: match.actual_in ?? null,
      aircraft_type_code: match.aircraft_type ?? null,
      registration: match.registration ?? null,
      terminal_origin: match.terminal_origin ?? null,
      terminal_destination: match.terminal_destination ?? null,
      gate_origin: match.gate_origin ?? null,
      gate_destination: match.gate_destination ?? null,
      actual_runway_off: match.actual_runway_off ?? null,
      actual_runway_on: match.actual_runway_on ?? null,
      route_distance_mi: match.route_distance ?? null,
      diverted: match.diverted ?? null,
      provider_status: match.status ?? null,
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
  historical: boolean,
): Promise<TrackInput | null> {
  const prefix = historical ? "/history" : "";
  const trackRes = await fetch(
    `${AEROAPI_BASE}${prefix}/flights/${encodeURIComponent(faFlightId)}/track`,
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

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function queryFlights(url: string, apiKey: string): Promise<AeroApiFlight[]> {
  const res = await fetch(url, { headers: { "x-apikey": apiKey } });
  if (res.status === 404) return [];
  if (!res.ok) throw new HttpError(502, `AeroAPI flights request failed: ${res.status}`);
  const data = await res.json() as { flights?: AeroApiFlight[] };
  return data.flights ?? [];
}

// Among flights matching the route, prefer the one whose LOCAL departure date equals
// the flight date (handles the ±1 day window + multiple daily instances); else nearest.
function pickFlight(
  flights: AeroApiFlight[],
  depIata: string | null,
  arrIata: string | null,
  flightDate: string,
): AeroApiFlight | null {
  let matches = flights.filter((f) =>
    (!depIata || f.origin?.code_iata === depIata) && (!arrIata || f.destination?.code_iata === arrIata)
  );
  // Relaxed: AeroAPI sometimes omits airport codes for obscure airports (null IATA/ICAO).
  // Match on the endpoint it DOES provide, requiring at least one real match.
  if (matches.length === 0) {
    matches = flights.filter((f) => {
      const depGiven = f.origin?.code_iata != null;
      const arrGiven = f.destination?.code_iata != null;
      const depOk = !depIata || !depGiven || f.origin?.code_iata === depIata;
      const arrOk = !arrIata || !arrGiven || f.destination?.code_iata === arrIata;
      const depMatch = !!depIata && f.origin?.code_iata === depIata;
      const arrMatch = !!arrIata && f.destination?.code_iata === arrIata;
      return depOk && arrOk && (depMatch || arrMatch);
    });
  }
  if (matches.length === 0) return null;

  // Local DEPARTURE date in the origin's timezone. Fall back through gate→wheels
  // departure times (a flight may expose only wheels-off) so the date is comparable.
  const localDate = (f: AeroApiFlight): string => {
    const t = f.scheduled_out ?? f.actual_out ?? f.scheduled_off ?? f.actual_off;
    if (!t) return "";
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: f.origin?.timezone ?? "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(t));
    } catch {
      return "";
    }
  };
  const exact = matches.find((f) => localDate(f) === flightDate);
  if (exact) return exact;

  // No exact local-date hit → pick the instance whose LOCAL departure date is closest
  // to the flight date. Comparing local dates (not raw UTC to noon-UTC) is essential:
  // a late-evening departure in a western timezone lands a day later in UTC, so a
  // UTC-noon distance would wrongly favour the *previous* day's instance.
  const target = Date.parse(`${flightDate}T00:00:00Z`);
  const dayDiff = (f: AeroApiFlight) => {
    const ld = localDate(f);
    return ld ? Math.abs(Date.parse(`${ld}T00:00:00Z`) - target) : Infinity;
  };
  return [...matches].sort((a, b) => dayDiff(a) - dayDiff(b))[0] ?? null;
}

function buildFlightIdent(
  airlineIcao: string | null,
  airlineIata: string | null,
  flightNumber: string,
): string {
  const code = airlineIcao ?? airlineIata; // ICAO is AeroAPI's canonical, reliable ident
  if (!code) return flightNumber;
  const suffix = stripAirlinePrefix(flightNumber);
  return `${code}${suffix}`;
}

function stripAirlinePrefix(flightNumber: string): string {
  return flightNumber.replace(/^[A-Z]{1,3}/, "");
}

function notFound(): EnrichFlightResult {
  return { found: false, provider: "aeroapi", flight: null, track: null, warnings: [] };
}
