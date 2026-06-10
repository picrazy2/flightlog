import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeFunction } from "@/lib/supabase";

// Shape the DB modal's add/edit form collects.
export interface FlightFormValues {
  flight_date: string;
  airline_iata: string;
  flight_number: string;
  dep_iata: string;
  arr_iata: string;
  sched_dep: string; // ISO (local datetime acceptable)
  sched_arr: string;
  cabin_class?: string | null;
  aircraft_type_code?: string | null;
  registration?: string | null;
  status?: string | null;
}

function refresh(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["flights"] });
  qc.invalidateQueries({ queryKey: ["bookings"] });
}

export function useCreateFlight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: FlightFormValues) =>
      invokeFunction("create-flight", { ...v, enrichment_mode: "none" }),
    onSuccess: () => refresh(qc),
  });
}

export function useUpdateFlight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...v }: FlightFormValues & { id: string }) =>
      invokeFunction("update-flight", { id, ...v }),
    onSuccess: () => refresh(qc),
  });
}

export function useDeleteFlight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invokeFunction("delete-flight", { id }),
    onSuccess: () => refresh(qc),
  });
}
