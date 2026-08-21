import { useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Dropdown } from "@/components/ui/Dropdown";
import { useStore } from "@/state/store";
import { useIsMobile } from "@/lib/useIsMobile";
import { useFlights } from "@/data/useFlights";
import { useBookings } from "@/data/useBookings";
import { useCreateFlight, useUpdateFlight, usePatchFlight, useDeleteFlight, type FlightFormValues } from "@/data/mutations";
import { invokeFunction } from "@/lib/supabase";
import { useAuth, signInWithGoogle, signOut } from "@/lib/auth";
import type { Flight } from "@/lib/types";
import { compact } from "@/lib/format";
import { currencySymbol } from "@/lib/fx";
import { AirlineLogo } from "@/components/ui/AirlineLogo";
import { StatusPill } from "@/components/ui/StatusPill";
import { FlightForm } from "./FlightForm";
import { BookingsTab } from "./BookingsTab";

// Per-flight (segment) cost: cash in its currency and/or points.
const costLabel = (f: Flight): string => {
  const parts: string[] = [];
  if (f.cost_cash_segment != null) parts.push(`${currencySymbol((f.cost_currency ?? "USD").toUpperCase())}${Math.round(f.cost_cash_segment).toLocaleString()}`);
  if ((f.cost_points_segment ?? 0) > 0) parts.push(`${compact(f.cost_points_segment!)} pts`);
  return parts.length ? parts.join(" + ") : "—";
};

type Tab = "flights" | "bookings" | "import";

const CABIN_LABELS: Record<string, string> = {
  economy: "Economy",
  premium_economy: "Premium",
  lie_flat_business: "Business",
  recliner_first: "First (recliner)",
  international_first: "First",
};
const CABIN_OPTS = ["", "economy", "premium_economy", "lie_flat_business", "recliner_first", "international_first"];

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


// One flight, as a row rather than a table line: the airline mark and route lead, and
// everything identifying the leg sits under it in one muted line.
function FlightRow({
  f,
  canWrite,
  saving,
  deleting,
  onCabin,
  onEdit,
  onDelete,
  onBooking,
}: {
  f: Flight;
  canWrite: boolean;
  saving: boolean;
  deleting: boolean;
  onCabin: (cabin: string | null) => void;
  onEdit: () => void;
  onDelete: () => void;
  onBooking: (bookingId: string) => void;
}) {
  const hasBooking = Boolean(f.booking_id);
  // Controls inside the row must not also trigger the row's own navigation.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <li
      // The row itself opens the booking, so the per-row "Booking ↗" link is gone —
      // it repeated on almost every line to say what the row already points at.
      // Rows with no booking stay inert rather than looking clickable and doing nothing.
      {...(hasBooking
        ? {
          role: "button" as const,
          tabIndex: 0,
          title: "Show this flight's booking",
          onClick: () => onBooking(f.booking_id!),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onBooking(f.booking_id!);
            }
          },
        }
        : {})}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:flex-nowrap",
        hasBooking && "focus-ring cursor-pointer hover:bg-surface-2/60",
      )}
    >
      <AirlineLogo iata={f.airline_iata} name={f.airline_name} treatment={f.airline_logo_treatment} />

      <div className="min-w-0 flex-1 basis-[55%] sm:basis-auto">
        {/* Three rows on a phone — date, then route, then the details — because the one
            wrapped meta line put the date and the fare on the same visual level as the
            route. Wider screens keep the date inline; a row of its own is wasted space. */}
        <div className="tnum text-caption leading-tight text-ink-faint sm:hidden">{f.flight_date}</div>
        <div className="flex items-baseline gap-2">
          <span className="truncate font-display text-title font-semibold text-ink">
            {f.dep_iata} <span className="text-ink-faint">→</span> {f.arr_iata}
          </span>
          <span className="shrink-0 font-mono text-caption text-ink-muted">
            {f.airline_iata}
            {f.flight_number}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-faint">
          <span className="tnum hidden sm:inline">{f.flight_date}</span>
          <span aria-hidden className="hidden sm:inline">·</span>
          {canWrite ? (
            <span className="inline-flex items-center gap-1">
              <select
                value={f.cabin_class ?? ""}
                disabled={saving}
                onClick={stop}
                onChange={(e) => onCabin(e.target.value || null)}
                className="focus-ring -my-0.5 rounded border border-border bg-surface-2 px-1 py-0.5 text-caption text-ink-muted"
              >
                {CABIN_OPTS.map((c) => (
                  <option key={c} value={c}>
                    {c ? CABIN_LABELS[c] ?? c : "— cabin —"}
                  </option>
                ))}
              </select>
              {saving && (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-ink-faint border-t-transparent" />
              )}
            </span>
          ) : (
            <span>{CABIN_LABELS[f.cabin_class ?? ""] ?? f.cabin_class ?? "—"}</span>
          )}
          <span aria-hidden>·</span>
          <span className="tnum whitespace-nowrap">{costLabel(f)}</span>
        </div>
      </div>

      {/* No status pill: the section a row sits in already says whether it's flown, and
          a badge repeated on all 366 of them was pure noise. Cancelled is the exception —
          it's the one status the grouping can't express. */}
      {f.status === "cancelled" && <StatusPill status={f.status} />}

      {/* Signed out is read-only, so the controls are absent rather than present-and-
          greyed: a row of dead buttons on every line reads as broken, not as locked. */}
      {canWrite && (
        <div className="ml-auto flex shrink-0 items-center gap-1" onClick={stop}>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="danger" size="sm" disabled={deleting} onClick={onDelete}>
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

export function DatabaseModal() {
  const setDbOpen = useStore((s) => s.setDbOpen);
  const userId = useStore((s) => s.userId); // active log; new rows/imports file under it
  const { user } = useAuth();
  const canWrite = !!user; // writing requires a signed-in (allowed) Google account
  const [tab, setTab] = useState<Tab>("flights");
  const [q, setQ] = useState("");
  const [year, setYear] = useState("all");
  const [airline, setAirline] = useState("all");
  const [savingCabinId, setSavingCabinId] = useState<string | null>(null); // row mid-save → show spinner
  const [highlightBooking, setHighlightBooking] = useState<string | null>(null); // jump-to from flights tab
  const [editing, setEditing] = useState<(Partial<FlightFormValues> & { id?: string }) | null>(null);
  const [csv, setCsv] = useState("");
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const mobile = useIsMobile();
  const flights = useFlights();
  const bookings = useBookings();
  const createM = useCreateFlight();
  const updateM = useUpdateFlight();
  const patchM = usePatchFlight();
  const deleteM = useDeleteFlight();
  const busy = createM.isPending || updateM.isPending;

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    // newest flights first in the table
    let data = [...(flights.data ?? [])].sort((a, b) => b.sched_dep.localeCompare(a.sched_dep));
    if (year !== "all") data = data.filter((f) => f.flight_date.slice(0, 4) === year);
    if (airline !== "all") data = data.filter((f) => f.airline_iata === airline);
    if (term) {
      data = data.filter((f) =>
        `${f.flight_date} ${f.airline_iata}${f.flight_number} ${f.dep_iata} ${f.arr_iata}`.toLowerCase().includes(term),
      );
    }
    return data;
  }, [flights.data, q, year, airline]);

  // Options come from the whole log, not the filtered rows, so picking a year never
  // empties the airline list (and vice versa) and leaves you unable to get back.
  const yearOptions = useMemo(() => {
    const years = [...new Set((flights.data ?? []).map((f) => f.flight_date.slice(0, 4)))]
      .sort((a, b) => b.localeCompare(a));
    return [{ value: "all", label: "All years" }, ...years.map((y) => ({ value: y, label: y }))];
  }, [flights.data]);

  const airlineOptions = useMemo(() => {
    const seen = new Map<string, { name: string; n: number }>();
    for (const f of flights.data ?? []) {
      const e = seen.get(f.airline_iata) ?? { name: f.airline_name ?? f.airline_iata, n: 0 };
      e.n += 1;
      seen.set(f.airline_iata, e);
    }
    return [
      { value: "all", label: "All airlines" },
      ...[...seen.entries()]
        .sort((a, b) => a[1].name.localeCompare(b[1].name))
        .map(([iata, e]) => ({ value: iata, label: `${e.name} · ${e.n}` })),
    ];
  }, [flights.data]);

  // Upcoming first and separated: they're the few rows worth acting on, and a shared
  // list buried them above hundreds of flown legs with only a pill to tell them apart.
  // Everything already flown then breaks into a table per year — a single 485-row list
  // has no landmarks, and the year is how you actually remember a trip.
  const groups = useMemo(() => {
    const byYear = new Map<string, Flight[]>();
    for (const f of rows) {
      if (f.status === "scheduled") continue;
      const y = f.flight_date.slice(0, 4);
      const bucket = byYear.get(y);
      if (bucket) bucket.push(f);
      else byYear.set(y, [f]);
    }
    return [
      { key: "upcoming", label: "Upcoming", rows: rows.filter((f) => f.status === "scheduled") },
      ...[...byYear.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([y, rs]) => ({ key: y, label: y, rows: rs })),
    ];
  }, [rows]);

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

  const tabOptions = [
    { value: "flights" as Tab, label: "Flights" },
    { value: "bookings" as Tab, label: "Bookings" },
    { value: "import" as Tab, label: "Import" },
  ];

  return (
    <Modal
      title="Database"
      onClose={() => setDbOpen(false)}
      actions={
        mobile ? (
          // Phone header holds the title and one auth control, nothing else — the
          // Segmented tabs squeezed "Database" down to "Da…".
          canWrite ? (
            <button onClick={() => signOut()} className="focus-ring shrink-0 rounded-md px-2 py-1 text-caption text-accent hover:bg-surface-2">
              Sign out
            </button>
          ) : (
            <button onClick={() => signInWithGoogle()} className="focus-ring shrink-0 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-caption text-ink">
              Sign in
            </button>
          )
        ) : (
          <Segmented
            aria-label="Table"
            size="sm"
            value={tab}
            onChange={(t) => setTab(t)}
            options={tabOptions}
          />
        )
      }
    >
      {mobile && (
        <div className="px-4 py-3">
          <Segmented
            aria-label="Table"
            size="sm"
            value={tab}
            onChange={(t) => setTab(t)}
            options={tabOptions}
            className="w-full"
          />
        </div>
      )}

      <div className="hidden items-center justify-between gap-3 border-b border-border bg-surface-2/40 px-5 py-2 text-caption sm:flex">
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
        <div className="flex flex-col gap-3 px-4 pb-4 pt-0 sm:p-5">
          {/* One row on a desktop; on a phone the search and the filters split onto
              separate lines — crammed together the input collapsed to about "Filt".
              sm:contents dissolves the wrappers so both flow into one row again. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex items-center gap-2 sm:contents">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter flights…"
                className="focus-ring min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-label text-ink placeholder:text-ink-faint sm:w-64 sm:flex-none"
              />
              <span className="shrink-0 text-caption text-ink-faint">{rows.length} rows</span>
              {(year !== "all" || airline !== "all" || q) && (
                <button
                  onClick={() => {
                    setYear("all");
                    setAirline("all");
                    setQ("");
                  }}
                  className="focus-ring shrink-0 rounded text-caption text-accent hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 sm:contents">
              <Dropdown
                aria-label="Filter by year"
                value={year}
                options={yearOptions}
                onChange={setYear}
                active={year !== "all"}
              />
              <Dropdown
                aria-label="Filter by airline"
                value={airline}
                options={airlineOptions}
                onChange={setAirline}
                active={airline !== "all"}
                menuWidth="w-[230px]"
              />
              {canWrite && (
                <div className="ml-auto">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setEditing(editing && !editing.id ? null : {})}
                  >
                    ＋ Add flight
                  </Button>
                </div>
              )}
            </div>
          </div>

          {editing && (
            <Modal title={editing.id ? "Edit flight" : "Add flight"} onClose={() => setEditing(null)} className="w-[min(640px,95vw)]">
              <div className="p-5">
                <FlightForm
                  initial={editing}
                  submitLabel={editing.id ? "Save changes" : "Add flight"}
                  busy={busy}
                  onSubmit={save}
                  onCancel={() => setEditing(null)}
                />
              </div>
            </Modal>
          )}

          <div className="flex flex-col gap-5">
          {groups.map((g) =>
            g.rows.length === 0 ? null : (
              // Two lists rather than one: upcoming legs are the handful you act on, and
              // they were previously indistinguishable from 480 flown rows above them.
              <section key={g.key} className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2 px-0.5">
                  <h3
                    className={cn(
                      "text-eyebrow tracking-[0.01em]",
                      g.key === "upcoming" ? "text-upcoming" : "text-ink-faint",
                    )}
                  >
                    {g.label}
                  </h3>
                  <span className="text-caption text-ink-faint">{g.rows.length}</span>
                </div>
                {/* Upcoming is tinted as a whole rather than badging each row: the table
                    is the signal, so the colour belongs to the container. */}
                <ul
                  className={cn(
                    "divide-y overflow-hidden rounded-lg border",
                    g.key === "upcoming"
                      ? "divide-upcoming/20 border-upcoming/35 bg-upcoming/[0.07]"
                      : "divide-border border-border",
                  )}
                >
                  {g.rows.map((f) => (
                    <FlightRow
                      key={f.id}
                      f={f}
                      canWrite={canWrite}
                      saving={savingCabinId === f.id}
                      deleting={deleteM.isPending}
                      onCabin={(cabin) => {
                        setSavingCabinId(f.id);
                        patchM
                          .mutateAsync({ id: f.id, cabin_class: cabin })
                          .finally(() => setSavingCabinId((cur) => (cur === f.id ? null : cur)));
                      }}
                      onEdit={() => setEditing(toForm(f))}
                      onDelete={() => {
                        if (confirm(`Delete ${f.airline_iata}${f.flight_number} on ${f.flight_date}?`))
                          deleteM.mutate(f.id);
                      }}
                      onBooking={(id) => {
                        setTab("bookings");
                        setHighlightBooking(id);
                      }}
                    />
                  ))}
                </ul>
              </section>
            ),
          )}
          </div>
        </div>
      )}

      {tab === "bookings" && (
        <BookingsTab
          bookings={bookings.data ?? []}
          flights={flights.data ?? []}
          canWrite={canWrite}
          highlightId={highlightBooking}
          onChanged={() => {
            bookings.refetch();
            flights.refetch();
          }}
        />
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
