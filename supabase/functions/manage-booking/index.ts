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

  return { ok: true as const, id: bookingId };
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
