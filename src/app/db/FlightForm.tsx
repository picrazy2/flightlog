import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { FlightFormValues } from "@/data/mutations";

const CABINS = ["", "economy", "premium_economy", "lie_flat_business", "recliner_first", "international_first"];

const field =
  "focus-ring w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-label text-ink placeholder:text-ink-faint";

interface Props {
  initial?: Partial<FlightFormValues>;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (v: FlightFormValues) => void;
  onCancel: () => void;
}

// Add/edit form for a flight. Times use datetime-local; seconds appended on submit.
export function FlightForm({ initial, submitLabel, busy, onSubmit, onCancel }: Props) {
  const [v, setV] = useState<FlightFormValues>({
    flight_date: initial?.flight_date ?? "",
    airline_iata: initial?.airline_iata ?? "",
    flight_number: initial?.flight_number ?? "",
    dep_iata: initial?.dep_iata ?? "",
    arr_iata: initial?.arr_iata ?? "",
    sched_dep: initial?.sched_dep ?? "",
    sched_arr: initial?.sched_arr ?? "",
    cabin_class: initial?.cabin_class ?? "",
    aircraft_type_code: initial?.aircraft_type_code ?? "",
    registration: initial?.registration ?? "",
    status: initial?.status ?? "completed",
  });
  const set = (k: keyof FlightFormValues, val: string) => setV((s) => ({ ...s, [k]: val }));

  const submit = () => {
    const norm = (t: string) => (t && t.length === 16 ? `${t}:00` : t); // datetime-local → seconds
    onSubmit({
      ...v,
      airline_iata: v.airline_iata.toUpperCase(),
      dep_iata: v.dep_iata.toUpperCase(),
      arr_iata: v.arr_iata.toUpperCase(),
      sched_dep: norm(v.sched_dep),
      sched_arr: norm(v.sched_arr),
      cabin_class: v.cabin_class || null,
      aircraft_type_code: v.aircraft_type_code || null,
      registration: v.registration || null,
    });
  };

  return (
    <div className="grid grid-cols-2 gap-2.5 rounded-lg border border-border bg-surface-1 p-3 sm:grid-cols-4">
      <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
        <span className="text-caption text-ink-muted">Date</span>
        <input type="date" className={field} value={v.flight_date} onChange={(e) => set("flight_date", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">Airline (IATA)</span>
        <input className={field} maxLength={2} placeholder="UA" value={v.airline_iata} onChange={(e) => set("airline_iata", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">Flight #</span>
        <input className={field} placeholder="123" value={v.flight_number} onChange={(e) => set("flight_number", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">Status</span>
        <select className={field} value={v.status ?? ""} onChange={(e) => set("status", e.target.value)}>
          <option value="completed">completed</option>
          <option value="scheduled">scheduled</option>
          <option value="cancelled">cancelled</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">From (IATA)</span>
        <input className={field} maxLength={3} placeholder="SFO" value={v.dep_iata} onChange={(e) => set("dep_iata", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">To (IATA)</span>
        <input className={field} maxLength={3} placeholder="JFK" value={v.arr_iata} onChange={(e) => set("arr_iata", e.target.value)} />
      </label>
      <label className="col-span-2 flex flex-col gap-1">
        <span className="text-caption text-ink-muted">Scheduled departure</span>
        <input type="datetime-local" className={field} value={v.sched_dep} onChange={(e) => set("sched_dep", e.target.value)} />
      </label>
      <label className="col-span-2 flex flex-col gap-1">
        <span className="text-caption text-ink-muted">Scheduled arrival</span>
        <input type="datetime-local" className={field} value={v.sched_arr} onChange={(e) => set("sched_arr", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">Cabin</span>
        <select className={field} value={v.cabin_class ?? ""} onChange={(e) => set("cabin_class", e.target.value)}>
          {CABINS.map((c) => (
            <option key={c} value={c}>
              {c || "—"}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">Aircraft code</span>
        <input className={field} placeholder="B738" value={v.aircraft_type_code ?? ""} onChange={(e) => set("aircraft_type_code", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">Registration</span>
        <input className={field} placeholder="N12345" value={v.registration ?? ""} onChange={(e) => set("registration", e.target.value)} />
      </label>
      <div className="col-span-2 flex items-end justify-end gap-2 sm:col-span-4">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
