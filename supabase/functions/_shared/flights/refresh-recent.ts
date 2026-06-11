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
    not_found: countOutcome(results, "not_found"),
    skipped: countOutcome(results, "skipped"),
    failed: countOutcome(results, "failed"),
    results,
  };
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

  // Already enriched: only keep re-running to pick up a still-missing track while the
  // flight is recent enough that the provider plausibly has one. Old enriched flights
  // without a track are done (avoids an unbounded re-query/billing loop).
  return !flight.has_track && now.getTime() - schedArrival <= TRACK_RETRY_MS;
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
    const enrichment = await enrichFlight({
      flight_date: flight.flight_date,
      airline_iata: flight.airline_iata,
      airline_icao: icaoByIata?.get(flight.airline_iata) ?? null,
      flight_number: flight.flight_number,
      dep_iata: flight.dep_iata,
      arr_iata: flight.arr_iata,
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

function buildRefreshRecentUpdateRow(
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
