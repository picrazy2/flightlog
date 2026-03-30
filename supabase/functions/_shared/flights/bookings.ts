import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { HttpError } from "./http.ts";
import { hasBookingPayload, normalizeBookingInput } from "./normalize.ts";
import type { BookingInput } from "./types.ts";

export async function upsertBookingIfPresent(
  supabase: SupabaseClient,
  booking: BookingInput | null | undefined,
  defaultUserId: string | null,
) {
  if (!booking || !hasBookingPayload(booking)) {
    return null;
  }

  const row = normalizeBookingInput(booking, defaultUserId);

  if (row.id) {
    const { data, error } = await supabase
      .from("bookings")
      .upsert(row, { onConflict: "id" })
      .select("id")
      .single();

    if (error) {
      throw new HttpError(400, `Failed to upsert booking: ${error.message}`);
    }

    return data.id as string;
  }

  const { data, error } = await supabase
    .from("bookings")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    throw new HttpError(400, `Failed to create booking: ${error.message}`);
  }

  return data.id as string;
}

export async function resolveUpdatedBookingId(
  supabase: SupabaseClient,
  booking: BookingInput | null | undefined,
  existingBookingId: string | null,
  defaultUserId: string | null,
) {
  if (booking === undefined) {
    return existingBookingId;
  }

  if (booking === null) {
    return null;
  }

  return await upsertBookingIfPresent(supabase, booking, defaultUserId);
}
