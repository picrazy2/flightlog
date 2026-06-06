import { createClient } from "npm:@supabase/supabase-js@2";

import { enrichFlight } from "../_shared/flights/enrich.ts";
import { HttpError, toHttpError } from "../_shared/flights/http.ts";
import { importCsvFlights } from "../_shared/flights/import-csv.ts";
import { createAeroApiProvider } from "../_shared/flights/providers/aeroapi.ts";
import { createFR24Provider } from "../_shared/flights/providers/fr24api.ts";
import type {
  ImportCsvRequest,
  ImportCsvResult,
} from "../_shared/flights/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function handleImportCsvRequest(
  request: Request,
  dependencies?: {
    supabase?: ReturnType<typeof createAdminClient>;
  },
) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    requireAuthorizedRequest(request);
    const body = await parseRequest(request);
    const supabase = dependencies?.supabase ?? createAdminClient();
    const result = await importCsvFlights(supabase, body, {
      enrichFlight: (flight) => enrichFlight(flight, buildProviders()),
    });

    return jsonResponse<ImportCsvResult & { ok: true }>({
      ok: true,
      ...result,
    });
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
  Deno.serve((request) => handleImportCsvRequest(request));
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

async function parseRequest(request: Request): Promise<ImportCsvRequest> {
  if (request.method !== "POST") {
    throw new HttpError(405, "Only POST is supported");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("text/csv")) {
    return { csv_text: await request.text() };
  }

  if (contentType.includes("application/json")) {
    return await request.json() as ImportCsvRequest;
  }

  throw new HttpError(
    400,
    "Content-Type must be application/json or text/csv",
  );
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
