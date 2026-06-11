import { createClient } from "npm:@supabase/supabase-js@2";

import { HttpError, toHttpError } from "../_shared/flights/http.ts";
import { requireAuthedUser } from "../_shared/auth.ts";
import { enrichFlight } from "../_shared/flights/enrich.ts";
import { createAeroApiProvider } from "../_shared/flights/providers/aeroapi.ts";
import { createFR24Provider } from "../_shared/flights/providers/fr24api.ts";
import { createFlight } from "../_shared/flights/service.ts";
import type { CreateFlightRequest } from "../_shared/flights/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CreateFlightResult = {
  ok: true;
  flight: Record<string, unknown>;
  track: Record<string, unknown> | null;
  warnings: string[];
};

export async function handleCreateFlightRequest(
  request: Request,
  dependencies?: {
    supabase?: ReturnType<typeof createAdminClient>;
  },
) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await requireAuthedUser(request);
    const body = await parseRequest(request);
    const supabase = dependencies?.supabase ?? createAdminClient();
    const result = await createFlight(supabase, body, {
      enrichFlight: (req) => enrichFlight(req, buildProviders()),
    });

    return jsonResponse<CreateFlightResult>({
      ok: true,
      flight: result.flight,
      track: result.track,
      warnings: result.warnings,
    }, 201);
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
  Deno.serve((request) => handleCreateFlightRequest(request));
}

function buildProviders() {
  const aeroApiKey = Deno.env.get("AEROAPI_KEY");
  const fr24ApiKey = Deno.env.get("FR24_API_KEY");
  return {
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


async function parseRequest(request: Request): Promise<CreateFlightRequest> {
  if (request.method !== "POST") {
    throw new HttpError(405, "Only POST is supported");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(400, "Content-Type must be application/json");
  }

  return await request.json() as CreateFlightRequest;
}

function jsonResponse<T>(payload: T, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });
}
