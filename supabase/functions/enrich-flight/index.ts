import { HttpError, toHttpError } from "../_shared/flights/http.ts";
import { enrichFlight } from "../_shared/flights/enrich.ts";
import { createAeroApiProvider } from "../_shared/flights/providers/aeroapi.ts";
import { createFR24Provider } from "../_shared/flights/providers/fr24api.ts";
import type {
  EnrichFlightRequest,
  FlightInput,
} from "../_shared/flights/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EnrichFlightHttpResult = {
  ok: true;
  found: boolean;
  provider: string | null;
  flight: FlightInput | null;
  track: Record<string, unknown> | null;
  warnings: string[];
};

export async function handleEnrichFlightRequest(
  request: Request,
  dependencies: {
    enrichFlight?: typeof enrichFlight;
  } = {},
) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    requireAuthorizedRequest(request);
    const body = await parseRequest(request);
    const fn = dependencies.enrichFlight ?? enrichFlight;
    const result = await fn(body, buildProviders());

    return jsonResponse<EnrichFlightHttpResult>({
      ok: true,
      found: result.found,
      provider: result.provider,
      flight: result.flight,
      track:
        result.track?.geojson && result.track.source && result.track.recorded_at
          ? {
            geojson: result.track.geojson,
            source: result.track.source,
            recorded_at: result.track.recorded_at,
          }
          : null,
      warnings: result.warnings,
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
  Deno.serve((request) => handleEnrichFlightRequest(request));
}

function buildProviders() {
  const aeroApiKey = Deno.env.get("AEROAPI_KEY");
  const fr24ApiKey = Deno.env.get("FR24_API_KEY");
  return {
    // manual diagnostic lookups can target old flights — allow the AeroAPI historical path
    aeroapiStandardBackfillActive: true,
    aeroapi: aeroApiKey ? createAeroApiProvider(aeroApiKey) : undefined,
    fr24api: fr24ApiKey ? createFR24Provider(fr24ApiKey) : undefined,
  };
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

async function parseRequest(request: Request): Promise<EnrichFlightRequest> {
  if (request.method !== "POST") {
    throw new HttpError(405, "Only POST is supported");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(400, "Content-Type must be application/json");
  }

  return await request.json() as EnrichFlightRequest;
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
