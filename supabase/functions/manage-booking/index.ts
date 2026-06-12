import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { HttpError, toHttpError } from "../_shared/flights/http.ts";
import { requireAuthedUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Fields the DB modal lets a signed-in user edit on a booking. Anything else is left alone.
const EDITABLE = [
  "booking_platform",
  "booking_ref_platform",
  "booking_refs_airline",
  "cost_cash",
  "cost_currency",
  "cost_points",
  "points_program",
] as const;

interface ManageBookingRequest {
  id?: string; // present → update an existing booking
  user_id?: string; // for a new booking (defaults to 'alex')
  flight_ids?: string[]; // flights to (re)link to this booking
  fields?: Record<string, unknown>;
}

function pickFields(fields: Record<string, unknown> | undefined) {
  const row: Record<string, unknown> = {};
  if (!fields) return row;
  for (const k of EDITABLE) if (k in fields) row[k] = fields[k];
  return row;
}

async function manageBooking(supabase: SupabaseClient, body: ManageBookingRequest) {
  const fields = pickFields(body.fields);
  let bookingId = body.id ?? null;

  if (bookingId) {
    if (Object.keys(fields).length > 0) {
      const { error } = await supabase.from("bookings").update(fields).eq("id", bookingId);
      if (error) throw new HttpError(400, `Failed to update booking: ${error.message}`);
    }
  } else {
    const insert = { ...fields, user_id: body.user_id ?? "alex" };
    const { data, error } = await supabase.from("bookings").insert(insert).select("id").single();
    if (error) throw new HttpError(400, `Failed to create booking: ${error.message}`);
    bookingId = data.id as string;
  }

  // Link the chosen flights to this booking (only those without one, unless re-pointing).
  if (Array.isArray(body.flight_ids) && body.flight_ids.length > 0) {
    const { error } = await supabase
      .from("flights")
      .update({ booking_id: bookingId })
      .in("id", body.flight_ids);
    if (error) throw new HttpError(400, `Failed to link flights: ${error.message}`);
  }

  // Convert the cash to USD at the booking date (historical rate) for accurate spend totals.
  if (bookingId) await setBookingUsd(supabase, bookingId);

  return { ok: true as const, id: bookingId };
}

const STATIC_USD: Record<string, number> = {
  USD: 1, CNY: 0.14, EUR: 1.08, GBP: 1.27, HKD: 0.128, JPY: 0.0067, CAD: 0.74, SGD: 0.74,
  AUD: 0.66, KRW: 0.00075, TWD: 0.031, ZAR: 0.054, MXN: 0.052, THB: 0.028, MYR: 0.22,
  CHF: 1.1, NZD: 0.6, AED: 0.27, TRY: 0.029, VND: 0.00004, CZK: 0.043, MAD: 0.10, PEN: 0.27,
};
// Historical {currency}->USD rate at a date via the @fawazahmed0 CDN; static fallback.
async function rateToUsd(currency: string, date: string): Promise<number> {
  const cur = (currency || "USD").toUpperCase();
  if (cur === "USD") return 1;
  try {
    const r = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${cur.toLowerCase()}.min.json`);
    if (r.ok) {
      const d = await r.json();
      const v = d?.[cur.toLowerCase()]?.usd;
      if (typeof v === "number") return v;
    }
  } catch { /* fall through */ }
  return STATIC_USD[cur] ?? 1;
}

async function setBookingUsd(supabase: SupabaseClient, bookingId: string) {
  const { data: bk } = await supabase.from("bookings").select("cost_cash, cost_currency").eq("id", bookingId).single();
  if (!bk || bk.cost_cash == null) return;
  const { data: fls } = await supabase.from("flights").select("id, flight_date, cost_cash_segment").eq("booking_id", bookingId);
  const dates = (fls ?? []).map((f: { flight_date: string }) => f.flight_date).filter(Boolean).sort();
  const date = dates[0] ?? new Date().toISOString().slice(0, 10);
  const rate = await rateToUsd(bk.cost_currency ?? "USD", date);
  await supabase.from("bookings").update({ cost_cash_usd: Math.round(bk.cost_cash * rate * 100) / 100 }).eq("id", bookingId);
  for (const f of fls ?? []) {
    if (f.cost_cash_segment == null) continue;
    const fr = await rateToUsd(bk.cost_currency ?? "USD", f.flight_date);
    await supabase.from("flights").update({ cost_cash_segment_usd: Math.round(f.cost_cash_segment * fr * 100) / 100 }).eq("id", f.id);
  }
}

function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new HttpError(500, "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function handleManageBookingRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAuthedUser(request);
    const body = (await request.json()) as ManageBookingRequest;
    const supabase = createAdminClient();
    const result = await manageBooking(supabase, body);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const httpError = toHttpError(error);
    return new Response(JSON.stringify({ ok: false, error: httpError.message }), {
      status: httpError.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

if (import.meta.main) {
  Deno.serve((request) => handleManageBookingRequest(request));
}
