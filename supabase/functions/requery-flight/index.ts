import { createClient } from "npm:@supabase/supabase-js@2";

import { HttpError, toHttpError } from "../_shared/flights/http.ts";
import { enrichFlight } from "../_shared/flights/enrich.ts";
import { buildRefreshRecentUpdateRow, setFlownDistance } from "../_shared/flights/refresh-recent.ts";
import { createAeroApiProvider } from "../_shared/flights/providers/aeroapi.ts";
import { createFR24Provider } from "../_shared/flights/providers/fr24api.ts";
import type { RefreshRecentCandidate } from "../_shared/flights/types.ts";

// Forced re-query: unlike refresh-recent this ALWAYS hits the provider (no twin-reuse, no
// eligibility/age gate) and overwrites the stored track + provider fields. For fixing
// corrupted tracks or back-filling old flights the normal cron deliberately skips.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new HttpError(500, "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function buildProviders() {
  const aeroApiKey = Deno.env.get("AEROAPI_KEY");
  const fr24ApiKey = Deno.env.get("FR24_API_KEY");
  return {
    aeroapi: aeroApiKey ? createAeroApiProvider(aeroApiKey) : undefined,
    fr24api: fr24ApiKey ? createFR24Provider(fr24ApiKey) : undefined,
  };
}

function requireSecret(request: Request) {
  const expected = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!expected) throw new HttpError(500, "Missing EDGE_FUNCTION_SECRET");
  if (request.headers.get("authorization") !== `Bearer ${expected}`) throw new HttpError(401, "Unauthorized");
}

// deno-lint-ignore no-explicit-any
async function requeryOne(supabase: any, flightId: string, providers: ReturnType<typeof buildProviders>) {
  const { data, error } = await supabase.from("v_flights_with_airports").select("*").eq("id", flightId).limit(1);
  if (error) throw new HttpError(500, `Load failed for ${flightId}: ${error.message}`);
  const flight = (data?.[0] ?? null) as RefreshRecentCandidate | null;
  if (!flight) return { flight_id: flightId, outcome: "not_found", error: "no such flight" };

  // resolve ICAO ident (avoids AeroAPI IATA ambiguity)
  let airline_icao: string | null = null;
  if (flight.airline_iata) {
    const { data: al } = await supabase.from("airlines").select("icao").eq("iata", flight.airline_iata).limit(1);
    airline_icao = (al?.[0]?.icao as string | undefined) ?? null;
  }

  const enrichment = await enrichFlight(
    {
      flight_date: flight.flight_date,
      airline_iata: flight.airline_iata,
      airline_icao,
      flight_number: flight.flight_number,
      dep_iata: flight.dep_iata,
      arr_iata: flight.arr_iata,
      source: flight.source,
    },
    // forced requery is for old flights → allow the AeroAPI historical (Standard) backfill
    { ...providers, aeroapiStandardBackfillActive: true },
  );

  if (!enrichment.found || !enrichment.flight) {
    return { flight_id: flightId, outcome: "not_found", provider: enrichment.provider, warnings: enrichment.warnings };
  }

  const changes = buildRefreshRecentUpdateRow(flight, enrichment.flight);
  if (typeof changes.aircraft_type_code === "string" && changes.aircraft_type_code) {
    await supabase.from("aircraft_types").upsert({ code: changes.aircraft_type_code, name: changes.aircraft_type_code }, { onConflict: "code", ignoreDuplicates: true });
  }
  if (Object.keys(changes).length > 0) {
    const { error: uerr } = await supabase.from("flights").update(changes).eq("id", flightId);
    if (uerr) throw new HttpError(400, `Update failed for ${flightId}: ${uerr.message}`);
  }

  let flownMi: number | null = null;
  if (enrichment.track) {
    const { error: terr } = await supabase
      .from("tracks")
      .upsert(
        { flight_id: flightId, geojson: enrichment.track.geojson, source: enrichment.track.source, recorded_at: enrichment.track.recorded_at },
        { onConflict: "flight_id" },
      );
    if (terr) throw new HttpError(400, `Track upsert failed for ${flightId}: ${terr.message}`);
    await setFlownDistance(supabase, flight, enrichment.track.geojson);
    const { data: row } = await supabase.from("flights").select("flown_distance_mi").eq("id", flightId).limit(1);
    flownMi = (row?.[0]?.flown_distance_mi as number | undefined) ?? null;
  }

  return {
    flight_id: flightId,
    outcome: "refreshed",
    provider: enrichment.provider,
    has_track: Boolean(enrichment.track),
    flown_distance_mi: flownMi,
    provider_status: changes.provider_status ?? null,
    warnings: enrichment.warnings,
  };
}

export async function handleRequeryFlightRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    requireSecret(request);
    const body = (await request.json()) as { flight_id?: string; flight_ids?: string[] };
    const ids = body.flight_ids ?? (body.flight_id ? [body.flight_id] : []);
    if (ids.length === 0) throw new HttpError(400, "Provide flight_id or flight_ids");
    const supabase = createAdminClient();
    const providers = buildProviders();
    const results = [];
    for (const id of ids) results.push(await requeryOne(supabase, id, providers));
    return new Response(JSON.stringify({ ok: true, results }, null, 2), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (error) {
    const httpError = toHttpError(error);
    return new Response(JSON.stringify({ ok: false, error: httpError.message }), {
      status: httpError.status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
}

if (import.meta.main) {
  Deno.serve((request) => handleRequeryFlightRequest(request));
}
