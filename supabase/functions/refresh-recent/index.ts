import { createClient } from "npm:@supabase/supabase-js@2";

import { HttpError, toHttpError } from "../_shared/flights/http.ts";
import { enrichFlight } from "../_shared/flights/enrich.ts";
import { createAeroApiProvider } from "../_shared/flights/providers/aeroapi.ts";
import { createFR24Provider } from "../_shared/flights/providers/fr24api.ts";
import { refreshRecentFlights } from "../_shared/flights/refresh-recent.ts";
import { refreshGmailAccessToken, sendEmail } from "../_shared/gmail/gmail-client.ts";
import type { RefreshRecentRequest, RefreshRecentResult } from "../_shared/flights/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function handleRefreshRecentRequest(
  request: Request,
  dependencies?: {
    supabase?: ReturnType<typeof createAdminClient>;
    now?: Date;
  },
) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    requireAuthorizedRequest(request);
    const body = await parseRequest(request);
    const supabase = dependencies?.supabase ?? createAdminClient();
    const result = await refreshRecentFlights(supabase, body, {
      now: dependencies?.now,
      enrichFlight: (flight) =>
        enrichFlight(flight, buildProviders(dependencies?.now)),
    });

    // email the owner whenever the run actually sent ≥1 API query (eligible > 0)
    await notifyRun(result);

    return jsonResponse({
      ok: result.failed === 0,
      ...result,
    }, result.failed === 0 ? 200 : 207);
  } catch (error) {
    const httpError = toHttpError(error);
    return jsonResponse(
      {
        ok: false,
        error: httpError.message,
      },
      httpError.status,
    );
  }
}

if (import.meta.main) {
  Deno.serve((request) => handleRefreshRecentRequest(request));
}

// Notify the owner by email whenever the job actually queried the flight API. Flights
// filled from an already-enriched twin ("reused") cost nothing, so they don't count as
// a query — stay silent on no-op / all-reused runs, and never throw.
async function notifyRun(result: RefreshRecentResult) {
  const queried = result.eligible - result.reused;
  if (queried <= 0) return;
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  const to = Deno.env.get("GMAIL_OWNER_EMAIL");
  if (!clientId || !clientSecret || !refreshToken || !to) {
    console.warn("refresh-recent: email not configured (GOOGLE_*/GMAIL_OWNER_EMAIL)");
    return;
  }
  try {
    const token = await refreshGmailAccessToken(clientId, clientSecret, refreshToken);
    const lines = result.results.map((r) => `  • ${r.outcome}: ${r.flight_id}${r.error ? ` — ${r.error}` : ""}`).join("\n");
    const subject = `Journia refresh-recent: ${queried} queried, ${result.refreshed} enriched${result.reused ? `, ${result.reused} reused` : ""}`;
    const body = [
      "refresh-recent ran and sent at least one flight-API query.",
      "",
      `scanned:              ${result.scanned}`,
      `eligible:             ${result.eligible}`,
      `queried (paid):       ${queried}`,
      `refreshed:            ${result.refreshed}`,
      `reused (no query):    ${result.reused}`,
      `not found:            ${result.not_found}`,
      `skipped:              ${result.skipped}`,
      `failed:               ${result.failed}`,
      "",
      lines,
    ].join("\n");
    await sendEmail(token, to, subject, body);
  } catch (error) {
    console.error("refresh-recent: notify email failed", error);
  }
}

function buildProviders(now?: Date) {
  const aeroApiKey = Deno.env.get("AEROAPI_KEY");
  const fr24ApiKey = Deno.env.get("FR24_API_KEY");
  return {
    now,
    aeroapiStandardBackfillActive: parseBooleanEnv(
      Deno.env.get("AEROAPI_STANDARD_BACKFILL_ACTIVE"),
    ),
    aeroapi: aeroApiKey ? createAeroApiProvider(aeroApiKey) : undefined,
    fr24api: fr24ApiKey ? createFR24Provider(fr24ApiKey) : undefined,
  };
}

function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new HttpError(
      500,
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function requireAuthorizedRequest(request: Request) {
  const expectedToken = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!expectedToken) {
    throw new HttpError(500, "Missing EDGE_FUNCTION_SECRET");
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${expectedToken}`) {
    throw new HttpError(401, "Unauthorized");
  }
}

async function parseRequest(request: Request): Promise<RefreshRecentRequest> {
  if (request.method !== "POST") {
    throw new HttpError(405, "Only POST is supported");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {};
  }

  return await request.json() as RefreshRecentRequest;
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function parseBooleanEnv(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}
