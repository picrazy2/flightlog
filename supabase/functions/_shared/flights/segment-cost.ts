import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Recompute the per-segment cost for every flight on a booking. The booking's
// total cash/points is split across its legs weighted by each leg's great-circle
// distance (distance_mi). A single-leg booking gets the full amount; if any
// distance is missing the split falls back to an equal share. Safe to call
// repeatedly — it recomputes from scratch, so as more legs of a multi-email
// booking arrive over time the split self-corrects.
export async function recomputeBookingSegmentCost(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<void> {
  const { data: booking } = await supabase
    .from("bookings")
    .select("cost_cash, cost_points")
    .eq("id", bookingId)
    .single();
  if (!booking) return;

  const { data } = await supabase
    .from("flights")
    .select("id, distance_mi")
    .eq("booking_id", bookingId);
  const legs = (data ?? []) as Array<{ id: string; distance_mi: number | null }>;
  if (legs.length === 0) return;

  const totalDistance = legs.reduce((sum, f) => sum + (f.distance_mi ?? 0), 0);
  const cash = booking.cost_cash != null ? Number(booking.cost_cash) : null;
  const points = booking.cost_points != null ? Number(booking.cost_points) : null;

  for (const leg of legs) {
    const weight = totalDistance > 0
      ? (leg.distance_mi ?? 0) / totalDistance
      : 1 / legs.length;
    await supabase
      .from("flights")
      .update({
        cost_cash_segment: cash != null
          ? Math.round(cash * weight * 100) / 100
          : null,
        cost_points_segment: points != null ? Math.round(points * weight) : null,
      })
      .eq("id", leg.id);
  }
}
