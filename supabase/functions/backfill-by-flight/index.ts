import { createClient } from "npm:@supabase/supabase-js@2";

import { HttpError, toHttpError } from "../_shared/flights/http.ts";
import { backfillByFlight } from "../_shared/gmail/backfill-by-flight.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = { user_id?: string; message_ids?: string[] };

export async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    requireAuthorizedRequest(request);
    if (request.method !== "POST") throw new HttpError(405, "Only POST is supported");
    const body = (await readJson(request)) as Body;
    const userId = body.user_id?.trim();
    if (!userId) throw new HttpError(400, "user_id is required");

    const messageIds = Array.isArray(body.message_ids) ? body.message_ids : [];
    const supabase = createAdminClient();
    const account = await loadGmailAccount(supabase, userId);

    const result = await backfillByFlight(supabase, {
      userId,
      gmailClientId: requireEnv("GOOGLE_CLIENT_ID"),
      gmailClientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
      gmailRefreshToken: account.refreshToken,
      geminiApiKey: requireEnv("GEMINI_API_KEY"),
      owner: account.name || account.email ? { name: account.name, email: account.email } : undefined,
      messageIds,
    });

    return json({ ok: true, ...result });
  } catch (error) {
    const httpError = toHttpError(error);
    return json({ ok: false, error: httpError.message }, httpError.status);
  }
}

if (import.meta.main) Deno.serve(handleRequest);

// Resolve the mailbox for this user: gmail_accounts row, or the env owner (the primary
// account is GMAIL_OWNER_USER_ID, default "alex", whose token lives in env not the table).
async function loadGmailAccount(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<{ refreshToken: string; email: string | null; name: string | null }> {
  const { data, error } = await supabase
    .from("gmail_accounts")
    .select("refresh_token, email, name")
    .eq("user_id", userId)
    .eq("enabled", true)
    .limit(1);
  if (error) throw new HttpError(500, `gmail_accounts lookup failed: ${error.message}`);
  const row = data?.[0] as { refresh_token: string; email: string | null; name: string | null } | undefined;
  if (row) return { refreshToken: row.refresh_token, email: row.email, name: row.name };

  const ownerUserId = Deno.env.get("GMAIL_OWNER_USER_ID") ?? "alex";
  const envToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  if (userId === ownerUserId && envToken) {
    return { refreshToken: envToken, email: Deno.env.get("GMAIL_OWNER_EMAIL") ?? null, name: Deno.env.get("GMAIL_OWNER_NAME") ?? null };
  }
  throw new HttpError(404, `No Gmail account configured for user "${userId}"`);
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new HttpError(500, `Missing ${name}`);
  return v;
}

function createAdminClient() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function requireAuthorizedRequest(request: Request) {
  const expected = Deno.env.get("EDGE_FUNCTION_SECRET");
  if (!expected) throw new HttpError(500, "Missing EDGE_FUNCTION_SECRET");
  if (request.headers.get("authorization") !== `Bearer ${expected}`) throw new HttpError(401, "Unauthorized");
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}
