import { useQuery } from "@tanstack/react-query";
import { restGet } from "@/lib/supabase";
import { useStore } from "@/state/store";

export interface BookingRow {
  id: string;
  booking_refs_airline: { airline_iata: string; pnr: string }[] | null;
  booking_ref_platform: string | null;
  booking_platform: string | null;
  cost_cash: number | null;
  cost_currency: string | null;
  cost_points: number | null;
  points_program: string | null;
  emails: { message_id: string; subject?: string; kind?: string }[] | null;
}

export function useBookings() {
  const userId = useStore((s) => s.userId); // scope to the active log, like useFlights
  return useQuery({
    queryKey: ["bookings", userId],
    queryFn: () =>
      restGet<BookingRow[]>(
        `bookings?user_id=eq.${userId}&select=id,booking_refs_airline,booking_ref_platform,booking_platform,cost_cash,cost_currency,cost_points,points_program,emails&order=cost_cash.desc.nullslast`,
      ),
  });
}
