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
  const results: RefreshRecentFlightResult[] = [];

  for (const flight of eligibleFlights) {
    results.push(
      await refreshRecentFlight(
        supabase,
        flight,
        dependencies.enrichFlight,
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

  return !isProviderEnriched(flight) || !flight.has_track;
}

async function refreshRecentFlight(
  supabase: SupabaseClient,
  flight: RefreshRecentCandidate,
  enrichFlight?: (
    request: FlightInput,
  ) => Promise<EnrichFlightResult>,
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
      flight_number: flight.flight_number,
      dep_iata: flight.dep_iata,
      arr_iata: flight.arr_iata,
      source: flight.source,
    });

    if (!enrichment.found || !enrichment.flight) {
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
