import { useQuery } from "@tanstack/react-query";
import { restGet } from "@/lib/supabase";
import { useStore } from "@/state/store";
import type { Flight } from "@/lib/types";

const COLUMNS = [
  "id,user_id,flight_date,airline_iata,flight_number,dep_iata,arr_iata,sched_dep,sched_arr,provider_sched_dep,provider_sched_arr,provider_sched_takeoff,provider_sched_landing",
  "actual_dep,actual_arr,actual_takeoff,actual_landing,aircraft_type_code,registration,cabin_class,distance_mi,route_distance_mi,flown_distance_mi,status,source,booking_id",
  "terminal_origin,terminal_destination,gate_origin,gate_destination,actual_runway_off,actual_runway_on,diverted,provider_status",
  "cost_cash_segment,cost_points_segment,cost_cash_segment_usd,trip_type",
  "dep_name,dep_city,dep_country,dep_country_name,dep_continent,dep_lat,dep_lng,dep_timezone",
  "arr_name,arr_city,arr_country,arr_country_name,arr_continent,arr_lat,arr_lng,arr_timezone",
  "airline_name,alliance,aircraft_type_name,aircraft_type_body_class,aircraft_type_deck_count",
  "booking_refs_airline,booking_ref_platform,cost_cash,cost_currency,cost_cash_usd,cost_points,points_program,emails",
].join(",");

// Pull the whole flight set for the current user once and filter client-side.
export function useFlights() {
  const userId = useStore((s) => s.userId);
  return useQuery({
    queryKey: ["flights", userId],
    queryFn: () =>
      restGet<Flight[]>(
        `v_flights_with_airports?select=${COLUMNS}&user_id=eq.${userId}&order=sched_dep.asc&limit=5000`,
      ),
  });
}
