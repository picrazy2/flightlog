import { HttpError } from "../http.ts";
import type {
  EnrichFlightRequest,
  EnrichFlightResult,
  FlightInput,
  TrackInput,
} from "../types.ts";

const FR24_BASE = "https://fr24api.flightradar24.com";

type FR24FlightSummary = {
  fr24_id: string;
  flight: string | null;
  callsign: string | null;
  operating_as: string | null;
  type: string | null;
  reg: string | null;
  orig_icao: string | null;
  orig_iata: string | null;
  dest_icao: string | null;
  dest_iata: string | null;
  dest_icao_actual: string | null;
  dest_iata_actual: string | null;
  datetime_takeoff: string | null;
  datetime_landed: string | null;
  runway_takeoff: string | null;
  runway_landed: string | null;
  flight_time: number | null;
  first_seen: string | null;
  last_seen: string | null;
  flight_ended: boolean | null;
};

type FR24TrackPoint = {
  timestamp: string;
  lat: number;
  lon: number;
  alt: number;
  gspeed: number;
  vspeed: number;
  track: number;
  squawk: string;
  callsign: string | null;
  source: string;
};

const FR24_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Accept-Version": "v1",
  Accept: "application/json",
});

export function createFR24Provider(
  apiToken: string,
): (request: EnrichFlightRequest) => Promise<EnrichFlightResult> {
  return async function (
    request: EnrichFlightRequest,
  ): Promise<EnrichFlightResult> {
    const flightDate = request.flight_date!;
    const flightIdent = buildFlightIdent(
      request.airline_iata ?? null,
      request.flight_number!,
    );

    // Anchor on the scheduled departure (UTC) when known, else midday of the flight date.
    // FR24's flight_datetime_from/to only behaves with DATE-ALIGNED bounds
    // (00:00:00Z..23:59:59Z) — mid-day bounds return nothing — so query a date-aligned
    // ±1-day window around the anchor. The ±1 day also covers overnight flights whose
    // real departure lands on the calendar day before/after flight_date in UTC.
    const parsedAnchor = request.sched_dep ? Date.parse(request.sched_dep) : NaN;
    const anchor = Number.isNaN(parsedAnchor) ? Date.parse(`${flightDate}T12:00:00Z`) : parsedAnchor;
    const start = `${addDays(anchor, -1)}T00:00:00Z`;
    const end = `${addDays(anchor, 1)}T23:59:59Z`;

    const params = new URLSearchParams({
      flights: flightIdent,
      flight_datetime_from: start,
      flight_datetime_to: end,
    });

    const summaryRes = await fetch(
      `${FR24_BASE}/api/flight-summary/full?${params}`,
      { headers: FR24_HEADERS(apiToken) },
    );

    if (summaryRes.status === 404) {
      return notFound();
    }

    if (!summaryRes.ok) {
      throw new HttpError(
        502,
        `FR24 flight-summary request failed: ${summaryRes.status}`,
      );
    }

    const summaryData = await summaryRes.json() as {
      data?: FR24FlightSummary[];
    };
    const summaries = summaryData.data ?? [];

    const match = pickSummary(
      summaries,
      request.dep_iata ?? null,
      request.arr_iata ?? null,
      anchor,
    );
    if (!match) {
      return notFound();
    }

    const warnings: string[] = [];
    const track = await fetchTrack(match.fr24_id, apiToken, warnings);

    const airlineIata = request.airline_iata ?? extractAirlineIata(match.flight);
    const flightNumberSuffix = match.flight
      ? stripAirlinePrefix(match.flight)
      : stripAirlinePrefix(request.flight_number!);

    const flight: FlightInput = {
      flight_date: flightDate,
      airline_iata: airlineIata ?? undefined,
      flight_number: flightNumberSuffix,
      dep_iata: match.orig_iata ?? request.dep_iata ?? undefined,
      arr_iata: match.dest_iata_actual ?? match.dest_iata ?? request.arr_iata ?? undefined,
      // FR24 has no scheduled gate times — leave undefined so base request values are preserved
      actual_takeoff: match.datetime_takeoff ?? null,
      actual_landing: match.datetime_landed ?? null,
      aircraft_type_code: match.type ?? null,
      registration: match.reg ?? null,
      source: "fr24api",
      raw_provider: match,
    };

    return { found: true, provider: "fr24api", flight, track, warnings };
  };
}

async function fetchTrack(
  fr24Id: string,
  apiToken: string,
  warnings: string[],
): Promise<TrackInput | null> {
  const trackRes = await fetch(
    `${FR24_BASE}/api/flight-tracks?flight_id=${encodeURIComponent(fr24Id)}`,
    { headers: FR24_HEADERS(apiToken) },
  );

  if (!trackRes.ok) {
    warnings.push(
      `FR24 track request failed for ${fr24Id}: ${trackRes.status}`,
    );
    return null;
  }

  const trackData = await trackRes.json() as Array<{
    fr24_id: string;
    tracks: FR24TrackPoint[];
  }>;

  const tracks = trackData[0]?.tracks ?? [];
  if (tracks.length === 0) {
    return null;
  }

  return {
    geojson: {
      type: "LineString",
      coordinates: tracks.map((p) => [p.lon, p.lat]),
    },
    source: "fr24api",
    recorded_at: tracks[tracks.length - 1].timestamp,
  };
}

function pickSummary(
  summaries: FR24FlightSummary[],
  depIata: string | null,
  arrIata: string | null,
  anchorMs: number,
): FR24FlightSummary | null {
  if (summaries.length === 0) return null;

  const matches = summaries.filter((s) => {
    if (depIata && s.orig_iata !== depIata) return false;
    if (arrIata) {
      const dest = s.dest_iata_actual ?? s.dest_iata;
      if (dest !== arrIata) return false;
    }
    return true;
  });
  // No dep/arr to match on → can't disambiguate; take the first.
  const pool = depIata || arrIata ? matches : summaries;
  if (pool.length === 0) return null;

  // A ±1-day window on a daily route returns several operations; pick the one whose
  // takeoff (or first_seen) is closest to the scheduled departure. This fixes overnight
  // flights and daily-repeat ambiguity that a naive first-match got wrong.
  return pool.reduce((best, s) => {
    const t = Date.parse(s.datetime_takeoff ?? s.first_seen ?? "");
    const bt = Date.parse(best.datetime_takeoff ?? best.first_seen ?? "");
    if (Number.isNaN(t)) return best;
    if (Number.isNaN(bt)) return s;
    return Math.abs(t - anchorMs) < Math.abs(bt - anchorMs) ? s : best;
  });
}

function buildFlightIdent(
  airlineIata: string | null,
  flightNumber: string,
): string {
  if (!airlineIata) return flightNumber;
  const suffix = stripAirlinePrefix(flightNumber);
  return `${airlineIata}${suffix}`;
}

function extractAirlineIata(flight: string | null): string | null {
  if (!flight) return null;
  const match = flight.match(/^([A-Z]{2})\d/);
  return match ? match[1] : null;
}

function stripAirlinePrefix(flightNumber: string): string {
  return flightNumber.replace(/^[A-Z]{1,3}/, "");
}

function addDays(ms: number, n: number): string {
  const d = new Date(ms);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function notFound(): EnrichFlightResult {
  return { found: false, provider: "fr24api", flight: null, track: null, warnings: [] };
}
