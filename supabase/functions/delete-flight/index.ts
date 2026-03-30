import { createClient } from "npm:@supabase/supabase-js@2";

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
    requireAuthorizedRequest(request);
    const body = await parseRequest(request);
    const flightId = requireUuid(body.id, "id");
    const supabase = dependencies?.supabase ?? createAdminClient();

    const { data: existingFlight, error: loadError } = await supabase
      .from("v_flights_with_airports")
      .select("*")
      .eq("id", flightId)
      .maybeSingle();

    if (loadError) {
      throw new HttpError(
        500,
        `Failed to load flight for deletion: ${loadError.message}`,
      );
    }

    if (!existingFlight) {
      throw new HttpError(404, `Flight not found: ${flightId}`);
    }

    const { error: deleteError } = await supabase
      .from("flights")
      .delete()
      .eq("id", flightId);

    if (deleteError) {
      throw new HttpError(
        400,
        `Failed to delete flight: ${deleteError.message}`,
      );
    }

    return jsonResponse<DeleteFlightResult>({
      ok: true,
      deleted_flight: existingFlight as Record<string, unknown>,
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

function requireUuid(value: string | undefined, field: string) {
  const uuid = typeof value === "string" ? value.trim() : "";
  if (
    !uuid ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(uuid)
  ) {
    throw new HttpError(400, `${field} must be a valid UUID`);
  }

  return uuid;
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

function toHttpError(error: unknown) {
  return error instanceof HttpError ? error : new HttpError(
    500,
    error instanceof Error ? error.message : "Unknown error",
  );
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
