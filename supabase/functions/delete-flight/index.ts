import { createClient } from "npm:@supabase/supabase-js@2";

import { HttpError, toHttpError } from "../_shared/flights/http.ts";
import { requireAuthedUser } from "../_shared/auth.ts";
import { deleteFlight } from "../_shared/flights/service.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DeleteFlightRequest = {
  id?: string;
};

type DeleteFlightResult = {
  ok: true;
  deleted_flight: Record<string, unknown>;
};

export async function handleDeleteFlightRequest(
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
    const deletedFlight = await deleteFlight(supabase, body.id);

    return jsonResponse<DeleteFlightResult>({
      ok: true,
      deleted_flight: deletedFlight,
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
  Deno.serve((request) => handleDeleteFlightRequest(request));
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


async function parseRequest(request: Request): Promise<DeleteFlightRequest> {
  if (request.method !== "POST") {
    throw new HttpError(405, "Only POST is supported");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(400, "Content-Type must be application/json");
  }

  return await request.json() as DeleteFlightRequest;
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
