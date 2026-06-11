import { useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { useStore } from "@/state/store";
import { useFlights } from "@/data/useFlights";
import { useBookings } from "@/data/useBookings";
import { useCreateFlight, useUpdateFlight, useDeleteFlight, type FlightFormValues } from "@/data/mutations";
import { invokeFunction } from "@/lib/supabase";
import { useAuth, signInWithGoogle, signOut } from "@/lib/auth";
import type { Flight } from "@/lib/types";
import { FlightForm } from "./FlightForm";

type Tab = "flights" | "bookings" | "import";

const th = "px-3 py-2 text-left text-caption font-medium text-ink-faint";
const td = "px-3 py-1.5 text-label text-ink";

function toForm(f: Flight): Partial<FlightFormValues> & { id: string } {
  return {
    id: f.id,
    flight_date: f.flight_date,
    airline_iata: f.airline_iata,
    flight_number: f.flight_number,
    dep_iata: f.dep_iata,
    arr_iata: f.arr_iata,
    sched_dep: f.sched_dep?.slice(0, 16),
    sched_arr: f.sched_arr?.slice(0, 16),
    cabin_class: f.cabin_class,
    aircraft_type_code: f.aircraft_type_code,
    registration: f.registration,
    status: f.status,
  };
}

export function DatabaseModal() {
  const setDbOpen = useStore((s) => s.setDbOpen);
  const userId = useStore((s) => s.userId); // active log; new rows/imports file under it
  const { user } = useAuth();
  const canWrite = !!user; // writing requires a signed-in (allowed) Google account
  const [tab, setTab] = useState<Tab>("flights");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<(Partial<FlightFormValues> & { id?: string }) | null>(null);
  const [csv, setCsv] = useState("");
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const flights = useFlights();
  const bookings = useBookings();
  const createM = useCreateFlight();
  const updateM = useUpdateFlight();
  const deleteM = useDeleteFlight();
  const busy = createM.isPending || updateM.isPending;

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const data = flights.data ?? [];
    if (!term) return data;
    return data.filter((f) =>
      `${f.flight_date} ${f.airline_iata}${f.flight_number} ${f.dep_iata} ${f.arr_iata}`.toLowerCase().includes(term),
    );
  }, [flights.data, q]);

  const save = (v: FlightFormValues) => {
    const action = editing?.id ? updateM.mutateAsync({ id: editing.id, ...v }) : createM.mutateAsync(v);
    action.then(() => setEditing(null)).catch(() => {});
  };

  const loadFile = async (file?: File | null) => {
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    const n = text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
    setCsvResult(`Loaded ${file.name} — ${n > 0 ? n : 0} row(s). Click Import.`);
  };

  // Import in small batches so a large file doesn't exceed the function/gateway timeout
  // (which leaves the request hanging). duplicate_mode "skip" makes this idempotent, so
  // a failed batch can be safely retried by re-importing.
  const runImport = async () => {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      setCsvResult("Need a header row plus at least one flight.");
      return;
    }
    const [header, ...rows] = lines;
    const CHUNK = 20;
    const totals = { created: 0, updated: 0, skipped: 0, failed: 0 };
    setCsvResult(`Importing 0/${rows.length}…`);
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const r = await invokeFunction<{ created: number; updated: number; skipped: number; failed: number }>(
          "import-csv",
          {
            csv_text: [header, ...rows.slice(i, i + CHUNK)].join("\n"),
            user_id: userId,
            duplicate_mode: "skip",
            enrichment_mode: "none",
          },
        );
        totals.created += r.created;
        totals.updated += r.updated;
        totals.skipped += r.skipped;
        totals.failed += r.failed;
        setCsvResult(
          `Importing ${Math.min(i + CHUNK, rows.length)}/${rows.length}… ` +
            `(created ${totals.created}, skipped ${totals.skipped}, failed ${totals.failed})`,
        );
        flights.refetch();
      }
      setCsvResult(`Done — created ${totals.created}, updated ${totals.updated}, skipped ${totals.skipped}, failed ${totals.failed}.`);
    } catch (e) {
      setCsvResult(`Stopped after ${totals.created + totals.skipped + totals.failed} rows: ${e instanceof Error ? e.message : String(e)}. Re-import to resume (dupes skip).`);
    }
  };

  return (
    <Modal
      title="Database"
      onClose={() => setDbOpen(false)}
      actions={
        <Segmented
          aria-label="Table"
          size="sm"
          value={tab}
          onChange={(t) => setTab(t)}
          options={[
            { value: "flights", label: "Flights" },
            { value: "bookings", label: "Bookings" },
            { value: "import", label: "Import" },
          ]}
        />
      }
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2/40 px-5 py-2 text-caption">
        {canWrite ? (
          <>
            <span className="text-ink-muted">Signed in as <span className="text-ink">{user!.email}</span></span>
            <button onClick={() => signOut()} className="focus-ring text-accent hover:underline">Sign out</button>
          </>
        ) : (
          <>
            <span className="text-ink-muted">Read-only — sign in to add / edit / delete.</span>
            <button onClick={() => signInWithGoogle()} className="focus-ring rounded-md border border-border bg-surface-1 px-2.5 py-1 text-label text-ink hover:bg-surface-2">
              Sign in with Google
            </button>
          </>
        )}
      </div>

      {tab === "flights" && (
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter flights…"
              className="focus-ring w-64 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-label text-ink placeholder:text-ink-faint"
            />
            <span className="text-caption text-ink-faint">{rows.length} rows</span>
            <div className="ml-auto">
              <Button
                variant="primary"
                size="sm"
                disabled={!canWrite}
                onClick={() => setEditing(editing && !editing.id ? null : {})}
              >
                ＋ Add flight
              </Button>
            </div>
          </div>

          {editing && (
            <FlightForm
              initial={editing}
              submitLabel={editing.id ? "Save changes" : "Add flight"}
              busy={busy}
              onSubmit={save}
              onCancel={() => setEditing(null)}
            />
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-surface-2">
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Flight</th>
                  <th className={th}>Route</th>
                  <th className={th}>Cabin</th>
                  <th className={th}>Status</th>
                  <th className={th}>Dist</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} className="border-t border-border hover:bg-surface-2/60">
                    <td className={td}>{f.flight_date}</td>
                    <td className={`${td} font-mono`}>
                      {f.airline_iata}
                      {f.flight_number}
                    </td>
                    <td className={td}>
                      {f.dep_iata} → {f.arr_iata}
                    </td>
                    <td className={`${td} text-ink-muted`}>{f.cabin_class ?? "—"}</td>
                    <td className={`${td} text-ink-muted`}>{f.status}</td>
                    <td className={`${td} tnum text-ink-muted`}>{f.distance_mi?.toLocaleString() ?? "—"}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <Button variant="ghost" size="sm" disabled={!canWrite} onClick={() => setEditing(toForm(f))}>
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={!canWrite || deleteM.isPending}
                        onClick={() => {
                          if (confirm(`Delete ${f.airline_iata}${f.flight_number} on ${f.flight_date}?`))
                            deleteM.mutate(f.id);
                        }}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "bookings" && (
        <div className="p-5">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-surface-2">
                <tr>
                  <th className={th}>PNR</th>
                  <th className={th}>Platform</th>
                  <th className={th}>Cash</th>
                  <th className={th}>Points</th>
                  <th className={th}>Program</th>
                  <th className={th}>Emails</th>
                </tr>
              </thead>
              <tbody>
                {(bookings.data ?? []).map((b) => (
                  <tr key={b.id} className="border-t border-border hover:bg-surface-2/60">
                    <td className={`${td} font-mono`}>
                      {b.booking_refs_airline?.map((r) => r.pnr).join(", ") || "—"}
                    </td>
                    <td className={`${td} text-ink-muted`}>{b.booking_platform ?? b.booking_ref_platform ?? "—"}</td>
                    <td className={`${td} tnum`}>
                      {b.cost_cash != null ? `${b.cost_cash.toLocaleString()} ${b.cost_currency ?? ""}` : "—"}
                    </td>
                    <td className={`${td} tnum`}>{b.cost_points != null ? b.cost_points.toLocaleString() : "—"}</td>
                    <td className={`${td} text-ink-muted`}>{b.points_program ?? "—"}</td>
                    <td className={`${td} text-ink-muted`}>{b.emails?.length ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "import" && (
        <div className="flex flex-col gap-3 p-5">
          <p className="text-label text-ink-muted">
            Drop a .csv file, choose one, or paste below. Headers: date, scheduled_dep_time_local,
            scheduled_arr_time_local, airline, flight, dep_airport, arr_airport (+ optional class, aircraft,
            registration). Imports in batches; duplicate rows are skipped.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              loadFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              loadFile(e.dataTransfer.files?.[0]);
            }}
            className={dragOver ? "rounded-md ring-2 ring-accent" : ""}
          >
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={10}
              placeholder={dragOver ? "Drop CSV to load…" : "Drop a .csv here, or paste rows…"}
              className="focus-ring w-full rounded-md border border-border bg-surface-2 p-3 font-mono text-caption text-ink placeholder:text-ink-faint"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button variant="primary" disabled={!canWrite || !csv.trim()} onClick={runImport}>
              Import CSV
            </Button>
            <Button variant="secondary" disabled={!canWrite} onClick={() => fileInput.current?.click()}>
              Choose file…
            </Button>
            {csvResult && <span className="text-label text-ink-muted">{csvResult}</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}
