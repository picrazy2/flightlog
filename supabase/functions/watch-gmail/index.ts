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

    const shared = sharedConfig();
    const accounts = await resolveAccounts(supabase, body.user_id ?? null);
    if (accounts.length === 0) {
      throw new HttpError(
        404,
        body.user_id
          ? `No Gmail account configured for user "${body.user_id}"`
          : "No Gmail accounts configured",
      );
    }

    // Process each mailbox into its own log. One account failing (bad token, quota)
    // must not abort the others, so per-account errors are captured, not thrown.
    const per_user: Array<{ user_id: string | null } & Partial<WatchGmailResult> & { error?: string }> = [];
    for (const account of accounts) {
      try {
        const result = await watchGmail(supabase, {
          ...shared,
          gmailRefreshToken: account.refreshToken,
          userId: account.userId,
          owner: account.owner,
          lookbackDays: body.lookback_days,
          after: body.after,
          before: body.before,
          notify: body.notify,
        });
        per_user.push({ user_id: account.userId, ...result });
      } catch (error) {
        per_user.push({
          user_id: account.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const totals = per_user.reduce(
      (acc, r) => ({
        messages_scanned: acc.messages_scanned + (r.messages_scanned ?? 0),
        imported: acc.imported + (r.imported ?? 0),
        updated: acc.updated + (r.updated ?? 0),
        cancelled: acc.cancelled + (r.cancelled ?? 0),
        skipped: acc.skipped + (r.skipped ?? 0),
        not_flight: acc.not_flight + (r.not_flight ?? 0),
        failed: acc.failed + (r.failed ?? 0),
      }),
      { messages_scanned: 0, imported: 0, updated: 0, cancelled: 0, skipped: 0, not_flight: 0, failed: 0 },
    );

    return jsonResponse({ ok: true, accounts: accounts.length, totals, per_user });
  } catch (error) {
    const httpError = toHttpError(error);
    return jsonResponse({ ok: false, error: httpError.message }, httpError.status);
  }
}

interface GmailAccount {
  userId: string;
  refreshToken: string;
  owner?: { name: string | null; email: string | null };
}

// Which mailboxes to scan. The env GOOGLE_REFRESH_TOKEN is the primary/legacy owner
// (GMAIL_OWNER_USER_ID, default "alex"); additional people live in gmail_accounts. A
// table row for the same user_id overrides the env token. targetUser (from body.user_id)
// narrows to a single account; null = everyone.
async function resolveAccounts(
  supabase: ReturnType<typeof createAdminClient>,
  targetUser: string | null,
): Promise<GmailAccount[]> {
  const byUser = new Map<string, GmailAccount>();

  const envToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  if (envToken) {
    const ownerName = Deno.env.get("GMAIL_OWNER_NAME");
    const ownerEmail = Deno.env.get("GMAIL_OWNER_EMAIL");
    const ownerUserId = Deno.env.get("GMAIL_OWNER_USER_ID") ?? "alex";
    byUser.set(ownerUserId, {
      userId: ownerUserId,
      refreshToken: envToken,
      owner: ownerName || ownerEmail ? { name: ownerName ?? null, email: ownerEmail ?? null } : undefined,
    });
  }

  let query = supabase
    .from("gmail_accounts")
    .select("user_id, refresh_token, email, name")
    .eq("enabled", true);
  if (targetUser) query = query.eq("user_id", targetUser);
  const { data, error } = await query;
  if (error) throw new HttpError(500, `gmail_accounts lookup failed: ${error.message}`);

  for (const row of (data ?? []) as Array<{ user_id: string; refresh_token: string; email: string | null; name: string | null }>) {
    byUser.set(row.user_id, {
      userId: row.user_id,
      refreshToken: row.refresh_token,
      owner: row.name || row.email ? { name: row.name, email: row.email } : undefined,
    });
  }

  const accounts = [...byUser.values()];
  return targetUser ? accounts.filter((a) => a.userId === targetUser) : accounts;
}

if (import.meta.main) {
  Deno.serve((request) => handleWatchGmailRequest(request));
}

// Credentials shared across every mailbox: one Google OAuth client + one Gemini key.
// Per-user refresh tokens / owner identity are resolved separately (resolveAccounts).
function sharedConfig() {
  const gmailClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const gmailClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

  if (!gmailClientId || !gmailClientSecret) {
    throw new HttpError(500, "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  }
  if (!geminiApiKey) {
    throw new HttpError(500, "Missing GEMINI_API_KEY");
  }

  return { gmailClientId, gmailClientSecret, geminiApiKey };
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
