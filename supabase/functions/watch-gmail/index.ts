import { createClient } from "npm:@supabase/supabase-js@2";

import { HttpError, toHttpError } from "../_shared/flights/http.ts";
import type { WatchGmailRequest, WatchGmailResult } from "../_shared/flights/types.ts";
import { watchGmail } from "../_shared/gmail/watch-gmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function handleWatchGmailRequest(
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
    const result = await watchGmail(supabase, buildConfig(body.user_id ?? null));

    return jsonResponse<WatchGmailResult & { ok: true }>({ ok: true, ...result });
  } catch (error) {
    const httpError = toHttpError(error);
    return jsonResponse({ ok: false, error: httpError.message }, httpError.status);
  }
}

if (import.meta.main) {
  Deno.serve((request) => handleWatchGmailRequest(request));
}

function buildConfig(userId: string | null) {
  const gmailClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const gmailClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const gmailRefreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

  if (!gmailClientId || !gmailClientSecret || !gmailRefreshToken) {
    throw new HttpError(
      500,
      "Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN",
    );
  }

  if (!geminiApiKey) {
    throw new HttpError(500, "Missing GEMINI_API_KEY");
  }

  return { gmailClientId, gmailClientSecret, gmailRefreshToken, geminiApiKey, userId };
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
    auth: { persistSession: false, autoRefreshToken: false },
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

async function parseRequest(request: Request): Promise<WatchGmailRequest> {
  if (request.method !== "POST") {
    throw new HttpError(405, "Only POST is supported");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {};
  }

  const text = await request.text();
  return text ? (JSON.parse(text) as WatchGmailRequest) : {};
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
