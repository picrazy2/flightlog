import { createClient } from "npm:@supabase/supabase-js@2";

import {
  refreshAirports,
  refreshCountries,
  type RefreshStats,
} from "../_shared/reference/ourairports.ts";
import {
  refreshAirlines,
  type AirlineRefreshStats,
} from "../_shared/reference/airlines.ts";
import { syncAirlineLogos } from "../_shared/reference/airline-logos.ts";
import {
  refreshAirlineAlliances,
  type AllianceRefreshStats,
} from "../_shared/reference/alliances.ts";
import {
  refreshAircraftTypeByCode,
  refreshAircraftTypes,
  type AircraftTypeRefreshStats,
} from "../_shared/reference/aircraft-types.ts";
import {
  refreshAirportBoundary,
  type AirportBoundaryRefreshStats,
} from "../_shared/reference/airport-boundaries.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RefreshScope =
  | "all"
  | "ourairports"
  | "countries"
  | "airports"
  | "airlines"
  | "airline_logos"
  | "alliances"
  | "aircraft_types"
  | "airport_boundaries";

type RefreshRequest = {
  scope?: RefreshScope;
  aircraft_type_code?: string;
  page_from?: number;
  page_to?: number;
  country_iso2?: string;
  airport_iata?: string;
  airline_iata?: string;
  force_logos?: boolean;
  logo_limit?: number;
};

type StepStats =
  | RefreshStats
  | AirlineRefreshStats
  | AllianceRefreshStats
  | AircraftTypeRefreshStats
  | AirportBoundaryRefreshStats;

type StepResult = {
  step: string;
  ok: boolean;
  stats?: StepStats;
  error?: string;
};

export async function handleRefreshReferenceDataRequest(
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
    const scope = body.scope ?? "all";
    const supabase = dependencies?.supabase ?? createAdminClient();
    const runId = await createRunLog(supabase, scope, body);
    const steps = await refreshReferenceData(supabase, scope, body);
    const failedSteps = steps.filter((step) => !step.ok);
    const status = failedSteps.length === 0
      ? "success"
      : failedSteps.length === steps.length
      ? "failed"
      : "partial_success";
    await finalizeRunLog(supabase, runId, status, steps);

    return jsonResponse({
      ok: failedSteps.length === 0,
      scope,
      status,
      steps,
    }, failedSteps.length === 0 ? 200 : 207);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : 500;

    return jsonResponse(
      {
        ok: false,
        error: message,
      },
      status,
    );
  }
}

if (import.meta.main) {
  Deno.serve((request) => handleRefreshReferenceDataRequest(request));
}

async function refreshReferenceData(
  supabase: ReturnType<typeof createAdminClient>,
  scope: RefreshScope,
  request: RefreshRequest,
) {
  const steps: StepResult[] = [];

  switch (scope) {
    case "countries":
      steps.push(await runStep("countries", () =>
        refreshCountries(supabase, { countryIso2: request.country_iso2 })
      ));
      break;
    case "airports":
      steps.push(await runStep("countries", () =>
        refreshCountries(supabase, {
          countryIso2: request.country_iso2,
        })
      ));
      steps.push(await runStep("airports", () =>
        refreshAirports(supabase, { airportIata: request.airport_iata })
      ));
      break;
    case "ourairports":
      steps.push(await runStep("countries", () =>
        refreshCountries(supabase, {
          countryIso2: request.country_iso2,
        })
      ));
      steps.push(await runStep("airports", () =>
        refreshAirports(supabase, { airportIata: request.airport_iata })
      ));
      break;
    case "airlines":
      steps.push(await runStep("airlines", () =>
        refreshAirlines(supabase, { airlineIata: request.airline_iata })
      ));
      steps.push(await runStep("alliances", () =>
        refreshAirlineAlliances(supabase, { airlineIata: request.airline_iata })
      ));
      // Only touches airlines with no treatment recorded, so a newly added carrier gets
      // its mark on the next refresh and the rest cost nothing.
      steps.push(await runStep("airline_logos", () =>
        syncAirlineLogos(supabase, { airlineIata: request.airline_iata })
      ));
      break;
    case "airline_logos":
      steps.push(await runStep("airline_logos", () =>
        syncAirlineLogos(supabase, {
          airlineIata: request.airline_iata,
          force: request.force_logos,
          limit: request.logo_limit,
        })
      ));
      break;
    case "alliances":
      steps.push(await runStep("alliances", () =>
        refreshAirlineAlliances(supabase, { airlineIata: request.airline_iata })
      ));
      break;
    case "aircraft_types":
      if (request.aircraft_type_code) {
        steps.push(await runStep("aircraft_types", () =>
          refreshAircraftTypeByCode(supabase, request.aircraft_type_code!)
        ));
      } else {
        steps.push(await runStep("aircraft_types", () =>
          refreshAircraftTypes(supabase, {
            pageFrom: request.page_from,
            pageTo: request.page_to,
          })
        ));
      }
      break;
    case "airport_boundaries":
      if (!request.airport_iata) {
        throw new Error("airport_iata is required for airport_boundaries");
      }
      steps.push(await runStep("airport_boundaries", () =>
        refreshAirportBoundary(supabase, request.airport_iata!)
      ));
      break;
    case "all":
      steps.push(await runStep("countries", () => refreshCountries(supabase)));
      steps.push(await runStep("airports", () => refreshAirports(supabase)));
      steps.push(await runStep("airlines", () => refreshAirlines(supabase)));
      steps.push(await runStep("alliances", () =>
        refreshAirlineAlliances(supabase)
      ));
      steps.push(await runStep("airline_logos", () => syncAirlineLogos(supabase)));
      break;
    default:
      throw new Error(`Unsupported scope: ${scope}`);
  }

  return steps;
}

async function runStep(
  step: string,
  fn: () => Promise<StepStats>,
): Promise<StepResult> {
  try {
    return {
      step,
      ok: true,
      stats: await fn(),
    };
  } catch (error) {
    return {
      step,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
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
    throw new Error("Missing EDGE_FUNCTION_SECRET");
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${expectedToken}`) {
    throw new Error("Unauthorized");
  }
}

async function parseRequest(request: Request): Promise<RefreshRequest> {
  if (request.method !== "POST") {
    throw new Error("Only POST is supported");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {};
  }

  return await request.json();
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

async function createRunLog(
  supabase: ReturnType<typeof createAdminClient>,
  scope: string,
  request: RefreshRequest,
) {
  const { data, error } = await supabase
    .from("reference_refresh_runs")
    .insert({
      scope,
      status: "running",
      request_params: request,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create refresh run log: ${error.message}`);
  }

  return data.id as string;
}

async function finalizeRunLog(
  supabase: ReturnType<typeof createAdminClient>,
  runId: string,
  status: "success" | "partial_success" | "failed",
  steps: StepResult[],
) {
  const failedMessages = steps
    .filter((step) => !step.ok && step.error)
    .map((step) => `${step.step}: ${step.error}`);

  const { error } = await supabase
    .from("reference_refresh_runs")
    .update({
      status,
      results: steps,
      error_text: failedMessages.length > 0 ? failedMessages.join("\n") : null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    throw new Error(`Failed to finalize refresh run log: ${error.message}`);
  }
}
