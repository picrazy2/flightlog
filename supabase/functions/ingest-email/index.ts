import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { HttpError, toHttpError } from "../_shared/flights/http.ts";
import { parseEmailForFlights } from "../_shared/gmail/gemini-parser.ts";
import { buildFlightDetail, type FlightDetail } from "../_shared/gmail/flight-detail.ts";
import { processMessage } from "../_shared/gmail/watch-gmail.ts";

// Inbound endpoint for the Cloudflare Email Worker on journia@akguo.com. The worker
// parses the MIME and posts it here; this files the flights and hands back a line of
// prose the worker emails back to whoever forwarded it.
//
// Attribution comes from the envelope sender, matched against users.email — so Emily
// forwarding lands in Emily's log and Alex's in his, off one shared address. An
// unrecognised sender is refused rather than filed under a default: this address is
// reachable by anyone who can send mail.

interface IngestRequest {
  message_id?: string;
  from?: string;
  subject?: string;
  date?: string;
  body?: string;
  attachments?: Array<{ mimeType?: string; filename?: string; dataB64?: string }>;
}

// "Emily Zhai <emszhai98@gmail.com>" → "emszhai98@gmail.com"
function bareAddress(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  return (angled ? angled[1] : from).trim().toLowerCase();
}

async function resolveSender(supabase: SupabaseClient, from: string) {
  const email = bareAddress(from);
  if (!email) throw new HttpError(400, "Missing sender address");
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw new HttpError(500, `User lookup failed: ${error.message}`);
  if (!data) {
    throw new HttpError(403, `${email} isn't a known Journia user, so nothing was imported.`);
  }
  return data as { id: string; name: string | null; email: string | null };
}

// What the sender gets back. Same template as the inbox-scan notification — a forward is
// filed exactly like a scanned booking, so it is reported exactly like one, with every
// resolved field shown and the unresolved ones called out. The wording differs only
// where the two paths genuinely differ (a forward is one message, not a run).
function replyFor(
  outcome: string,
  detail: FlightDetail,
  count: number,
  warnings: string[],
  user: string,
): string {
  if (count === 0) {
    const head = outcome === "cancelled"
      ? `Marked the matching flight(s) cancelled in ${user}'s log.`
      : outcome === "skipped"
      ? `Already in ${user}'s log — nothing to add.`
      : `Couldn't find a flight in that. Forward the confirmation email itself, or a ` +
        `screenshot showing the flight number, date and airports.`;
    return warnings.length
      ? `${head}\n\nNotes:\n${warnings.map((w) => `  · ${w}`).join("\n")}`
      : head;
  }

  const verb = outcome === "updated" ? "Updated" : "Added";
  return [
    `${verb} ${count} flight${count === 1 ? "" : "s"} in ${user}'s log.`,
    `Every field recorded is listed below — check it against what you forwarded.`,
    ``,
    detail.blocks.join("\n\n"),
    ``,
    ...(detail.gaps.length
      ? [`⚠ Did not resolve — worth a look:`, ...detail.gaps, ``]
      : []),
    ...(warnings.length
      ? [`Notes:`, ...warnings.map((w) => `  · ${w}`), ``]
      : []),
  ].join("\n").trimEnd();
}

async function ingest(supabase: SupabaseClient, body: IngestRequest) {
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) throw new HttpError(500, "Missing GEMINI_API_KEY");

  const user = await resolveSender(supabase, body.from ?? "");

  const message = {
    id: body.message_id || `ingest-${Date.now()}`,
    subject: body.subject ?? "",
    from: body.from ?? "",
    date: body.date ?? new Date().toISOString(),
    body: body.body ?? "",
    attachments: (body.attachments ?? [])
      .filter((a) => a.dataB64)
      .map((a) => ({
        filename: a.filename || "attachment",
        mimeType: a.mimeType || "application/pdf",
        data: a.dataB64!,
      })),
  };

  const owner = { name: user.name, email: user.email };
  const result = await processMessage(
    supabase,
    message,
    (email) => parseEmailForFlights(geminiApiKey, email, owner, { forwarded: true }),
    user.id,
    // A forward is the claim of ownership; a screenshot rarely names its passenger.
    { requireOwnerIsTraveler: false },
  );

  const detail = await buildFlightDetail(supabase, result.flight_ids);

  return {
    ok: true as const,
    user_id: user.id,
    outcome: result.outcome,
    flight_ids: result.flight_ids,
    reply: replyFor(result.outcome, detail, result.flight_ids.length, result.warnings, user.name ?? user.id),
  };
}

function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new HttpError(500, "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function handleIngestEmailRequest(request: Request) {
  try {
    if (request.method !== "POST") throw new HttpError(405, "POST only");

    const secret = Deno.env.get("INGEST_SECRET") ?? Deno.env.get("EDGE_FUNCTION_SECRET");
    const auth = request.headers.get("Authorization") ?? "";
    if (!secret || auth !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorized");

    const result = await ingest(createAdminClient(), await request.json() as IngestRequest);
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    const httpError = toHttpError(error);
    // The message is surfaced to the sender by the worker, so keep it human-readable.
    return new Response(JSON.stringify({ ok: false, error: httpError.message }), {
      status: httpError.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

if (import.meta.main) {
  Deno.serve((request) => handleIngestEmailRequest(request));
}
