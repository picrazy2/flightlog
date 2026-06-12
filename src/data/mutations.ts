import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeFunction } from "@/lib/supabase";
import { useStore } from "@/state/store";

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
  const userId = useStore((s) => s.userId); // file the new flight under the active log
  return useMutation({
    mutationFn: (v: FlightFormValues) =>
      invokeFunction("create-flight", { ...v, user_id: userId, enrichment_mode: "none" }),
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

// Partial in-place edit (e.g. inline cabin change) — update-flight merges with the
// existing row, so only the changed fields need to be sent.
export function usePatchFlight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...fields }: { id: string } & Partial<FlightFormValues>) =>
      invokeFunction("update-flight", { id, ...fields }),
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

// Create or update a booking and (optionally) link flights to it.
export interface ManageBookingInput {
  id?: string; // present → update; absent → create
  flight_ids?: string[];
  fields?: Record<string, unknown>;
}
export function useManageBooking() {
  const qc = useQueryClient();
  const userId = useStore((s) => s.userId);
  return useMutation({
    mutationFn: (v: ManageBookingInput) =>
      invokeFunction("manage-booking", { ...v, user_id: v.id ? undefined : userId }),
    onSuccess: () => refresh(qc),
  });
}
