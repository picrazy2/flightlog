import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { HttpError } from "./http.ts";
import {
  type EnrichFlightResult,
  type FlightInput,
  type FlightSource,
  type RefreshRecentCandidate,
  type RefreshRecentFlightResult,
  type RefreshRecentRequest,
  type RefreshRecentResult,
} from "./types.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const LANDING_BUFFER_MS = 30 * 60 * 1000;
// Providers only retain position tracks for recent flights. Once a flight has been
// provider-enriched, keep retrying ONLY for a still-missing track within this window;
// after it, stop — otherwise old trackless flights get re-queried (and re-billed)
// on every run forever.
const TRACK_RETRY_MS = 14 * 24 * 60 * 60 * 1000;
// A flight queried while still airborne/taxiing comes back missing its arrival actuals
// (actual_landing / actual_arr gate-in) — provider_status is e.g. "Landed / Taxiing".
// Keep re-querying such an incompletely-enriched flight on each hourly run until this
// many hours past scheduled arrival, then stop — otherwise a flight whose provider never
// reports a gate-in time would be re-queried (and re-billed) every run forever. The
// window is the cost bound: at most ~one query/hour up to this point per such flight.
const COMPLETION_RETRY_MS = 12 * 60 * 60 * 1000;

// Actual flown distance (mi) = haversine over [dep, ...track points, arr]; gap bridges
// and gate stitches are great circles, and haversine between two points IS that arc.
function havMi(a: [number, number], b: [number, number]): number {
  const R = 3958.7613;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function trackCoords(geojson: unknown): [number, number][] {
  const g = geojson as { type?: string; coordinates?: unknown } | null;
  if (g?.type === "LineString") return (g.coordinates as [number, number][]) ?? [];
  if (g?.type === "MultiLineString") return ((g.coordinates as [number, number][][]) ?? []).flat();
  return [];
}
export async function setFlownDistance(supabase: SupabaseClient, flight: RefreshRecentCandidate, geojson: unknown) {
  const f = flight as unknown as { dep_lat?: number | null; dep_lng?: number | null; arr_lat?: number | null; arr_lng?: number | null };
  const pts: [number, number][] = [];
  if (f.dep_lat != null && f.dep_lng != null) pts.push([f.dep_lng, f.dep_lat]);
  for (const c of trackCoords(geojson)) if (c && c.length >= 2) pts.push([c[0], c[1]]);
  if (f.arr_lat != null && f.arr_lng != null) pts.push([f.arr_lng, f.arr_lat]);
  if (pts.length < 2) return;
  let mi = 0;
  for (let i = 1; i < pts.length; i++) mi += havMi(pts[i - 1], pts[i]);
  await supabase.from("flights").update({ flown_distance_mi: Math.round(mi) }).eq("id", flight.id);
}

export async function refreshRecentFlights(
  supabase: SupabaseClient,
  request: RefreshRecentRequest = {},
  dependencies: {
    enrichFlight?: (
      request: FlightInput,
    ) => Promise<EnrichFlightResult>;
    now?: Date;
    batchLimit?: number;
  } = {},
): Promise<RefreshRecentResult> {
  const now = dependencies.now ?? new Date();
  const limit = parseLimit(request.limit, dependencies.batchLimit);
  const candidates = await loadRefreshRecentCandidates(supabase, request.flight_id);
  const eligibleFlights = selectEligibleFlights(candidates, now).slice(0, limit);
  const neededIatas = [...new Set(eligibleFlights.map((f) => f.airline_iata).filter(Boolean))];
  const icaoByIata = await loadAirlineIcaoMap(supabase, neededIatas);
  const results: RefreshRecentFlightResult[] = [];

  for (const flight of eligibleFlights) {
    results.push(
      await refreshRecentFlight(
        supabase,
        flight,
        dependencies.enrichFlight,
        icaoByIata,
      ),
    );
  }

  return {
    scanned: candidates.length,
    eligible: eligibleFlights.length,
    refreshed: countOutcome(results, "refreshed"),
    reused: countOutcome(results, "reused"),
    not_found: countOutcome(results, "not_found"),
    skipped: countOutcome(results, "skipped"),
    failed: countOutcome(results, "failed"),
    results,
  };
}

// Provider-owned columns copied verbatim from an already-enriched twin (same physical
// flight, another row). Excludes user-owned fields (sched_dep/arr, cabin, booking).
const TWIN_COPY_COLUMNS = [
  "provider_sched_dep",
  "provider_sched_arr",
  "provider_sched_takeoff",
  "provider_sched_landing",
  "actual_dep",
  "actual_takeoff",
  "actual_landing",
  "actual_arr",
  "aircraft_type_code",
  "registration",
  "terminal_origin",
  "terminal_destination",
  "gate_origin",
  "gate_destination",
  "actual_runway_off",
  "actual_runway_on",
  "route_distance_mi",
  "diverted",
  "provider_status",
  "raw_provider",
] as const;

// Find another row for the exact same flight (date + airline + number + route) that the
// provider has already resolved (provider_status set, incl. "not_found"). Lets us clone
// that result instead of paying for a duplicate provider query — e.g. when two users
// flew the same flight. Returns null when no such twin exists.
async function findEnrichedTwin(
  supabase: SupabaseClient,
  flight: RefreshRecentCandidate,
): Promise<(Record<string, unknown> & { id: string; status: string | null }) | null> {
  const { data, error } = await supabase
    .from("flights")
    .select(`id, status, ${TWIN_COPY_COLUMNS.join(", ")}`)
    .eq("flight_date", flight.flight_date)
    .eq("airline_iata", flight.airline_iata)
    .eq("flight_number", flight.flight_number)
    .eq("dep_iata", flight.dep_iata)
    .eq("arr_iata", flight.arr_iata)
    .neq("id", flight.id)
    .not("provider_status", "is", null)
    .limit(1);

  if (error) {
    throw new HttpError(500, `Twin lookup failed for ${flight.id}: ${error.message}`);
  }
  // `data` is typed as a parse error because the select list is built dynamically;
  // cast through unknown to the real row shape.
  const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string; status: string | null }>;
  return rows[0] ?? null;
}

// Clone a twin's provider fields (and its track, if any) onto this flight. No API call.
async function copyTwinEnrichment(
  supabase: SupabaseClient,
  flight: RefreshRecentCandidate,
  twin: Record<string, unknown> & { id: string },
) {
  const changes: Record<string, unknown> = {};
  for (const col of TWIN_COPY_COLUMNS) assignProviderValue(changes, col, twin[col]);

  if (
    flight.status !== "cancelled" &&
    (changes.actual_dep || changes.actual_takeoff || changes.actual_landing || changes.actual_arr)
  ) {
    changes.status = "completed";
  }

  if (typeof changes.aircraft_type_code === "string" && changes.aircraft_type_code) {
    await supabase
      .from("aircraft_types")
      .upsert({ code: changes.aircraft_type_code, name: changes.aircraft_type_code }, { onConflict: "code", ignoreDuplicates: true });
  }

  if (Object.keys(changes).length > 0) {
    const { error } = await supabase.from("flights").update(changes).eq("id", flight.id);
    if (error) {
      throw new HttpError(400, `Failed to copy twin enrichment to ${flight.id}: ${error.message}`);
    }
  }

  // Clone the twin's track too, if it has one and this flight doesn't.
  if (!flight.has_track) {
    const { data: tracks } = await supabase
      .from("tracks")
      .select("geojson, source, recorded_at")
      .eq("flight_id", twin.id)
      .limit(1);
    const track = tracks?.[0] as { geojson: unknown; source: string; recorded_at: string } | undefined;
    if (track) {
      await supabase
        .from("tracks")
        .upsert({ flight_id: flight.id, geojson: track.geojson, source: track.source, recorded_at: track.recorded_at }, { onConflict: "flight_id" });
      await setFlownDistance(supabase, flight, track.geojson);
    }
  }
}

export function selectEligibleFlights(
  flights: RefreshRecentCandidate[],
  now: Date,
) {
  return flights
    .filter((flight) => isRefreshRecentEligible(flight, now))
    .sort((a, b) => compareTimestamp(a.sched_arr, b.sched_arr));
}

export function isRefreshRecentEligible(
  flight: RefreshRecentCandidate,
  now: Date,
) {
  if (flight.status === "cancelled") {
    return false;
  }

  const schedArrival = Date.parse(flight.sched_arr);
  if (Number.isNaN(schedArrival)) {
    return false;
  }

  if (schedArrival > now.getTime() - LANDING_BUFFER_MS) {
    return false;
  }

  // Not yet enriched → backfill once. A flight the provider has no record of is marked
  // 'not_found' (see refreshRecentFlight) so we never re-query — and re-bill — it.
  if (!isProviderEnriched(flight)) {
    return flight.provider_status !== "not_found";
  }

  // Already enriched: keep re-running only to fill in data the provider didn't have yet
  // at first query, and only while the flight is recent enough that the provider
  // plausibly will. Each branch is bounded by its own recency window so we never
  // re-query — and re-bill — a flight forever when the provider simply has no track or
  // never reports a gate-in time.
  const age = now.getTime() - schedArrival;
  //   (a) a position track, which providers only retain for a couple of weeks; or
  const wantsTrack = !flight.has_track && age <= TRACK_RETRY_MS;
  //   (b) the arrival actuals (wheels-on / gate-in), missing when the flight was still
  //       airborne or taxiing at query time (provider_status e.g. "Landed / Taxiing").
  //       Stop once the provider reports the flight has reached the gate ("Arrived /
  //       …"): if actual_arr is still null then, the provider simply has no gate-in time
  //       for this airport (observed at IST/ALA) and re-querying will never fill it.
  const fullyEnriched = Boolean(flight.actual_landing) && Boolean(flight.actual_arr);
  const wantsCompletion = !fullyEnriched && !hasArrivedAtGate(flight) &&
    age <= COMPLETION_RETRY_MS;
  return wantsTrack || wantsCompletion;
}

// AeroAPI marks a flight "Arrived / Gate Arrival" once it reaches the gate — a terminal
// state. (En-route/taxiing statuses like "Landed / Taxiing" are NOT arrived, so those
// keep retrying.)
function hasArrivedAtGate(flight: RefreshRecentCandidate) {
  return typeof flight.provider_status === "string" &&
    /^arrived\b/i.test(flight.provider_status.trim());
}

async function refreshRecentFlight(
  supabase: SupabaseClient,
  flight: RefreshRecentCandidate,
  enrichFlight?: (
    request: FlightInput,
  ) => Promise<EnrichFlightResult>,
  icaoByIata?: Map<string, string>,
): Promise<RefreshRecentFlightResult> {
  if (!enrichFlight) {
    return {
      flight_id: flight.id,
      outcome: "failed",
      provider: null,
      warnings: [],
      error: "refresh-recent enrichment provider is not configured",
    };
  }

  try {
    // Cost saver: if the same flight is already enriched on another row (e.g. another
    // user flew it), clone that result instead of paying for a duplicate provider query.
    const twin = await findEnrichedTwin(supabase, flight);
    if (twin) {
      await copyTwinEnrichment(supabase, flight, twin);
      return {
        flight_id: flight.id,
        outcome: "reused",
        provider: null,
        warnings: [`Reused provider data from existing flight ${twin.id}`],
      };
    }

    const enrichment = await enrichFlight({
      flight_date: flight.flight_date,
      airline_iata: flight.airline_iata,
      airline_icao: icaoByIata?.get(flight.airline_iata) ?? null,
      flight_number: flight.flight_number,
      dep_iata: flight.dep_iata,
      arr_iata: flight.arr_iata,
      // scheduled gate-out anchors FR24's flight match (airline schedule preferred)
      sched_dep: flight.provider_sched_dep ?? flight.sched_dep,
      source: flight.source,
    });

    if (!enrichment.found || !enrichment.flight) {
      // Record the miss so this flight is never re-queried (and never re-billed). Only
      // for not-yet-enriched flights; an already-enriched flight keeps its real status.
      if (!isProviderEnriched(flight)) {
        await supabase.from("flights").update({ provider_status: "not_found" }).eq("id", flight.id);
      }
      return {
        flight_id: flight.id,
        outcome: "not_found",
        provider: enrichment.provider,
        warnings: enrichment.warnings,
      };
    }

    const changes = buildRefreshRecentUpdateRow(flight, enrichment.flight);
    const shouldUpsertTrack = Boolean(enrichment.track);
    if (
      Object.keys(changes).length === 0 &&
      !shouldUpsertTrack
    ) {
      return {
        flight_id: flight.id,
        outcome: "skipped",
        provider: enrichment.provider,
        warnings: enrichment.warnings,
      };
    }

    if (Object.keys(changes).length > 0) {
      // Ensure the aircraft type exists (satisfy the FK) — AeroAPI sometimes returns a
      // code not yet in the reference table. Insert a stub; the quarterly doc8643
      // refresh fills in the real name/body_class later.
      if (typeof changes.aircraft_type_code === "string" && changes.aircraft_type_code) {
        await supabase
          .from("aircraft_types")
          .upsert({ code: changes.aircraft_type_code, name: changes.aircraft_type_code }, { onConflict: "code", ignoreDuplicates: true });
      }

      const { error } = await supabase
        .from("flights")
        .update(changes)
        .eq("id", flight.id);

      if (error) {
        throw new HttpError(
          400,
          `Failed to refresh flight ${flight.id}: ${error.message}`,
        );
      }
    }

    if (shouldUpsertTrack) {
      const { error } = await supabase
        .from("tracks")
        .upsert(
          {
            flight_id: flight.id,
            geojson: enrichment.track!.geojson,
            source: enrichment.track!.source,
            recorded_at: enrichment.track!.recorded_at,
          },
          { onConflict: "flight_id" },
        );

      if (error) {
        throw new HttpError(
          400,
          `Failed to save refreshed track for ${flight.id}: ${error.message}`,
        );
      }
      await setFlownDistance(supabase, flight, enrichment.track!.geojson);
    }

    return {
      flight_id: flight.id,
      outcome: "refreshed",
      provider: enrichment.provider,
      warnings: enrichment.warnings,
    };
  } catch (error) {
    return {
      flight_id: flight.id,
      outcome: "failed",
      provider: null,
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildRefreshRecentUpdateRow(
  existing: RefreshRecentCandidate,
  enriched: FlightInput,
) {
  const row: Record<string, unknown> = {};

  assignProviderValue(row, "provider_sched_dep", enriched.provider_sched_dep);
  assignProviderValue(row, "provider_sched_arr", enriched.provider_sched_arr);
  assignProviderValue(row, "provider_sched_takeoff", enriched.provider_sched_takeoff);
  assignProviderValue(row, "provider_sched_landing", enriched.provider_sched_landing);
  assignProviderValue(row, "actual_dep", enriched.actual_dep);
  assignProviderValue(
    row,
    "actual_takeoff",
    enriched.actual_takeoff,
  );
  assignProviderValue(
    row,
    "actual_landing",
    enriched.actual_landing,
  );
  assignProviderValue(row, "actual_arr", enriched.actual_arr);
  assignProviderValue(
    row,
    "aircraft_type_code",
    enriched.aircraft_type_code,
  );
  assignProviderValue(
    row,
    "registration",
    enriched.registration,
  );
  assignProviderValue(row, "terminal_origin", enriched.terminal_origin);
  assignProviderValue(row, "terminal_destination", enriched.terminal_destination);
  assignProviderValue(row, "gate_origin", enriched.gate_origin);
  assignProviderValue(row, "gate_destination", enriched.gate_destination);
  assignProviderValue(row, "actual_runway_off", enriched.actual_runway_off);
  assignProviderValue(row, "actual_runway_on", enriched.actual_runway_on);
  assignProviderValue(row, "route_distance_mi", enriched.route_distance_mi);
  assignProviderValue(row, "diverted", enriched.diverted);
  assignProviderValue(row, "provider_status", enriched.provider_status);

  if (enriched.raw_provider !== undefined) {
    row.raw_provider = enriched.raw_provider;
  }

  if (
    existing.status !== "cancelled" &&
    (
      row.actual_dep ||
      row.actual_takeoff ||
      row.actual_landing ||
      row.actual_arr ||
      existing.actual_dep ||
      existing.actual_takeoff ||
      existing.actual_landing ||
      existing.actual_arr
    )
  ) {
    row.status = "completed";
  }

  return row;
}

function assignProviderValue(
  row: Record<string, unknown>,
  field: string,
  enrichedValue: unknown,
) {
  if (
    enrichedValue !== null &&
    enrichedValue !== undefined
  ) {
    row[field] = enrichedValue;
  }
}

async function loadRefreshRecentCandidates(
  supabase: SupabaseClient,
  flightId?: string,
) {
  let query = supabase
    .from("v_flights_with_airports")
    .select("*");

  if (flightId) {
    query = query.eq("id", flightId);
  }

  const { data, error } = await query;

  if (error) {
    throw new HttpError(
      500,
      `Failed to load refresh-recent candidates: ${error.message}`,
    );
  }

  return ((data ?? []) as RefreshRecentCandidate[]);
}

// IATA → ICAO for ONLY the airlines we need (avoids the 1000-row default cap when the
// reference table is large). Defensive: any failure yields an empty map → IATA fallback.
async function loadAirlineIcaoMap(
  supabase: SupabaseClient,
  iatas: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (iatas.length === 0) return map;
  try {
    const { data } = await supabase.from("airlines").select("iata,icao").in("iata", iatas);
    for (const row of (data ?? []) as { iata: string | null; icao: string | null }[]) {
      if (row.iata && row.icao) map.set(row.iata, row.icao);
    }
  } catch {
    // ignore — fall back to IATA idents
  }
  return map;
}

function isProviderEnriched(flight: RefreshRecentCandidate) {
  return flight.raw_provider !== null && flight.raw_provider !== undefined;
}

function parseLimit(
  requestLimit: number | undefined,
  batchLimit: number | undefined,
) {
  const value = requestLimit ?? batchLimit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_LIMIT) {
    throw new HttpError(
      400,
      `limit must be an integer between 1 and ${MAX_LIMIT}`,
    );
  }

  return value;
}

function compareTimestamp(left: string, right: string) {
  return Date.parse(left) - Date.parse(right);
}

function countOutcome(
  results: RefreshRecentFlightResult[],
  outcome: RefreshRecentFlightResult["outcome"],
) {
  return results.filter((result) => result.outcome === outcome).length;
}
