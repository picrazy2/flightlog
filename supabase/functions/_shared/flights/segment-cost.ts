import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { rateToUsd } from "./fx.ts";

// Recompute the per-segment cost for every flight on a booking. The booking's
// total cash/points is split across its legs weighted by each leg's great-circle
// distance (distance_mi). A single-leg booking gets the full amount; if any
// distance is missing the split falls back to an equal share. Safe to call
// repeatedly — it recomputes from scratch, so as more legs of a multi-email
// booking arrive over time the split self-corrects.
//
// Also stores the USD equivalents (cost_cash_usd / cost_cash_segment_usd) converted at
// the flight date. Without this the client falls back to a present-day static rate, and
// any currency missing from that table counts 1:1 against USD.
export async function recomputeBookingSegmentCost(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<void> {
  const { data: booking } = await supabase
    .from("bookings")
    .select("cost_cash, cost_points, cost_currency")
    .eq("id", bookingId)
    .single();
  if (!booking) return;

  const { data } = await supabase
    .from("flights")
    .select("id, distance_mi, flight_date")
    .eq("booking_id", bookingId);
  const legs = (data ?? []) as Array<{ id: string; distance_mi: number | null; flight_date: string | null }>;
  if (legs.length === 0) return;

  const totalDistance = legs.reduce((sum, f) => sum + (f.distance_mi ?? 0), 0);
  const cash = booking.cost_cash != null ? Number(booking.cost_cash) : null;
  const points = booking.cost_points != null ? Number(booking.cost_points) : null;
  const currency = (booking.cost_currency as string | null) ?? "USD";

  // Booking total in USD, valued at the earliest leg (the date the fare was flown/priced).
  const bookingDate = legs.map((f) => f.flight_date).filter(Boolean).sort()[0] ?? null;
  const bookingRate = cash != null ? await rateToUsd(currency, bookingDate) : 1;
  if (cash != null) {
    await supabase
      .from("bookings")
      .update({ cost_cash_usd: Math.round(cash * bookingRate * 100) / 100 })
      .eq("id", bookingId);
  }

  for (const leg of legs) {
    const weight = totalDistance > 0
      ? (leg.distance_mi ?? 0) / totalDistance
      : 1 / legs.length;
    const segment = cash != null ? Math.round(cash * weight * 100) / 100 : null;
    const legRate = segment != null ? await rateToUsd(currency, leg.flight_date) : 1;
    await supabase
      .from("flights")
      .update({
        cost_cash_segment: segment,
        cost_points_segment: points != null ? Math.round(points * weight) : null,
        cost_cash_segment_usd: segment != null
          ? Math.round(segment * legRate * 100) / 100
          : null,
      })
      .eq("id", leg.id);
  }
}
