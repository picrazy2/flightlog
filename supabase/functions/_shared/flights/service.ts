import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { maybeEnrichAircraft } from "./aircraft-enrichment.ts";
import { resolveUpdatedBookingId, upsertBookingIfPresent } from "./bookings.ts";
import { HttpError } from "./http.ts";
import { normalizeFlightInput, requireUuid } from "./normalize.ts";
import {
  ensureAircraftTypeExists,
  ensureAirlineExists,
  ensureAirportsExist,
} from "./references.ts";
import type {
  AirportRow,
  CreateFlightRequest,
  CreateLikeFlightRequest,
  StoredFlightRow,
  UpdateFlightRequest,
} from "./types.ts";

export async function createFlight(
  supabase: SupabaseClient,
  request: CreateFlightRequest,
) {
  const warnings: string[] = [];
  const input = normalizeFlightInput(request);

  const airports = await ensureAirportsExist(supabase, [
    input.dep_iata,
    input.arr_iata,
  ]);
  await ensureAirlineExists(supabase, input.airline_iata);
  if (input.aircraft_type_code) {
    await ensureAircraftTypeExists(supabase, input.aircraft_type_code);
  }

  const bookingId = await upsertBookingIfPresent(
    supabase,
    request.booking,
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

  const { depAirport, arrAirport } = requireAirportPair(
    airports,
    input.dep_iata,
    input.arr_iata,
  );

  const row = {
    ...input,
    booking_id: bookingId,
    distance_mi: calculateDistanceMiles(depAirport, arrAirport),
  };

  const { data: insertedFlight, error: insertError } = await supabase
    .from("flights")
    .insert(row)
    .select("id")
    .single();

  if (insertError) {
    throw mapSupabaseWriteError(insertError, "create");
  }

  return {
    flight: await loadFlightViewById(
      supabase,
      insertedFlight.id as string,
      "created",
    ),
    warnings,
  };
}

export async function updateFlight(
  supabase: SupabaseClient,
  request: UpdateFlightRequest,
) {
  const flightId = requireUuid(request.id, "id");
  const warnings: string[] = [];
  const existingFlight = await loadExistingFlight(supabase, flightId);
  const mergedRequest = mergeUpdateRequest(existingFlight, request);
  const input = normalizeFlightInput(mergedRequest);

  const airports = await ensureAirportsExist(supabase, [
    input.dep_iata,
    input.arr_iata,
  ]);
  await ensureAirlineExists(supabase, input.airline_iata);
  if (input.aircraft_type_code) {
    await ensureAircraftTypeExists(supabase, input.aircraft_type_code);
  }

  const bookingId = await resolveUpdatedBookingId(
    supabase,
    request.booking,
    existingFlight.booking_id,
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

  const { depAirport, arrAirport } = requireAirportPair(
    airports,
    input.dep_iata,
    input.arr_iata,
  );

  const row = {
    ...input,
    booking_id: bookingId,
    distance_mi: calculateDistanceMiles(depAirport, arrAirport),
  };

  const { error: updateError } = await supabase
    .from("flights")
    .update(row)
    .eq("id", flightId);

  if (updateError) {
    throw mapSupabaseWriteError(updateError, "update");
  }

  return {
    flight: await loadFlightViewById(supabase, flightId, "updated"),
    warnings,
  };
}

export async function deleteFlight(
  supabase: SupabaseClient,
  flightIdInput: string | undefined,
) {
  const flightId = requireUuid(flightIdInput, "id");
  const deletedFlight = await loadFlightViewById(supabase, flightId, "deleted");

  const { error: deleteError } = await supabase
    .from("flights")
    .delete()
    .eq("id", flightId);

  if (deleteError) {
    throw new HttpError(400, `Failed to delete flight: ${deleteError.message}`);
  }

  return deletedFlight;
}

async function loadExistingFlight(
  supabase: SupabaseClient,
  flightId: string,
) {
  const { data, error } = await supabase
    .from("flights")
    .select("*")
    .eq("id", flightId)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      `Failed to load existing flight: ${error.message}`,
    );
  }

  if (!data) {
    throw new HttpError(404, `Flight not found: ${flightId}`);
  }

  return data as StoredFlightRow;
}

function mergeUpdateRequest(
  existingFlight: StoredFlightRow,
  request: UpdateFlightRequest,
): CreateLikeFlightRequest {
  return {
    user_id: request.user_id !== undefined
      ? request.user_id
      : existingFlight.user_id,
    flight_date: request.flight_date ?? existingFlight.flight_date,
    airline_iata: request.airline_iata ?? existingFlight.airline_iata,
    flight_number: request.flight_number ?? existingFlight.flight_number,
    dep_iata: request.dep_iata ?? existingFlight.dep_iata,
    arr_iata: request.arr_iata ?? existingFlight.arr_iata,
    sched_dep: request.sched_dep ?? existingFlight.sched_dep,
    sched_arr: request.sched_arr ?? existingFlight.sched_arr,
    actual_dep: request.actual_dep !== undefined
      ? request.actual_dep
      : existingFlight.actual_dep,
    actual_takeoff: request.actual_takeoff !== undefined
      ? request.actual_takeoff
      : existingFlight.actual_takeoff,
    actual_landing: request.actual_landing !== undefined
      ? request.actual_landing
      : existingFlight.actual_landing,
    actual_arr: request.actual_arr !== undefined
      ? request.actual_arr
      : existingFlight.actual_arr,
    aircraft_type_code: request.aircraft_type_code !== undefined
      ? request.aircraft_type_code
      : existingFlight.aircraft_type_code,
    registration: request.registration !== undefined
      ? request.registration
      : existingFlight.registration,
    cabin_class: request.cabin_class !== undefined
      ? request.cabin_class
      : existingFlight.cabin_class,
    status: request.status ?? existingFlight.status,
    source: request.source ?? existingFlight.source,
    raw_provider: request.raw_provider !== undefined
      ? request.raw_provider
      : existingFlight.raw_provider,
  };
}

async function loadFlightViewById(
  supabase: SupabaseClient,
  flightId: string,
  operation: "created" | "updated" | "deleted",
) {
  const { data, error } = await supabase
    .from("v_flights_with_airports")
    .select("*")
    .eq("id", flightId)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      `Failed to load ${operation} flight: ${error.message}`,
    );
  }

  if (!data) {
    throw new HttpError(404, `Flight not found: ${flightId}`);
  }

  return data as Record<string, unknown>;
}

function requireAirportPair(
  airports: Map<string, AirportRow>,
  depIata: string,
  arrIata: string,
) {
  const depAirport = airports.get(depIata);
  const arrAirport = airports.get(arrIata);
  if (!depAirport || !arrAirport) {
    throw new HttpError(500, "Failed to resolve airport coordinates");
  }

  return { depAirport, arrAirport };
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

function mapSupabaseWriteError(
  error: { code?: string; message: string },
  operation: "create" | "update",
) {
  if (error.code === "23505") {
    return new HttpError(409, "Flight already exists");
  }

  if (error.code === "23503") {
    return new HttpError(400, `Referenced record is missing: ${error.message}`);
  }

  if (error.code === "23514") {
    return new HttpError(400, `Invalid flight data: ${error.message}`);
  }

  return new HttpError(400, `Failed to ${operation} flight: ${error.message}`);
}
