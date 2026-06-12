import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { useManageBooking } from "@/data/mutations";
import type { BookingRow } from "@/data/useBookings";
import type { Flight } from "@/lib/types";

const th = "px-3 py-2 text-left text-caption font-medium text-ink-faint whitespace-nowrap";
const td = "px-3 py-1.5 text-label text-ink align-top";

const gmailUrl = (messageId: string) => `https://mail.google.com/mail/u/0/#all/${messageId}`;

const pnrText = (b: BookingRow) => b.booking_refs_airline?.map((r) => r.pnr).filter(Boolean).join(", ") ?? "";

// Editable inline cell — shows text; clicking turns it into an input that saves on blur/Enter.
function Cell({
  value,
  canWrite,
  numeric,
  placeholder,
  onSave,
}: {
  value: string;
  canWrite: boolean;
  numeric?: boolean;
  placeholder?: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!canWrite) return <span className={value ? "" : "text-ink-faint"}>{value || "—"}</span>;
  if (!editing)
    return (
      <button
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="focus-ring -mx-1 min-w-[2rem] rounded px-1 text-left hover:bg-surface-3"
      >
        {value || <span className="text-ink-faint">{placeholder ?? "—"}</span>}
      </button>
    );
  return (
    <input
      autoFocus
      value={draft}
      inputMode={numeric ? "decimal" : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onSave(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className="focus-ring w-24 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-label text-ink"
    />
  );
}

function EmailsCell({ emails }: { emails: BookingRow["emails"] }) {
  const list = emails ?? [];
  if (list.length === 0) return <span className="text-ink-faint">0</span>;
  return (
    <Popover
      align="start"
      trigger={({ toggle }) => (
        <button onClick={toggle} className="focus-ring rounded px-1 text-accent hover:underline">
          {list.length}
        </button>
      )}
    >
      {() => (
        <div className="w-[340px] max-w-[80vw] p-2">
          <div className="mb-1 px-1 text-caption text-ink-faint">{list.length} linked email{list.length > 1 ? "s" : ""}</div>
          <ul className="flex flex-col gap-0.5">
            {list.map((e, i) => (
              <li key={`${e.message_id}-${i}`}>
                <a
                  href={gmailUrl(e.message_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring block truncate rounded px-2 py-1 text-label text-ink hover:bg-surface-3 hover:text-accent"
                  title={e.subject ?? e.message_id}
                >
                  {e.kind && <span className="mr-1.5 text-caption text-ink-faint">[{e.kind}]</span>}
                  {e.subject || e.message_id}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Popover>
  );
}

export function BookingsTab({
  bookings,
  flights,
  canWrite,
  onChanged,
}: {
  bookings: BookingRow[];
  flights: Flight[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const manage = useManageBooking();
  const [adding, setAdding] = useState(false);

  const flightsByBooking = useMemo(() => {
    const m = new Map<string, Flight[]>();
    for (const f of flights) {
      if (!f.booking_id) continue;
      (m.get(f.booking_id) ?? m.set(f.booking_id, []).get(f.booking_id)!).push(f);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.flight_date.localeCompare(b.flight_date));
    return m;
  }, [flights]);

  // newest trips first (by the booking's latest linked flight date)
  const ordered = useMemo(() => {
    const lastDate = (b: BookingRow) => {
      const fs = flightsByBooking.get(b.id);
      return fs && fs.length ? fs[fs.length - 1].flight_date : "";
    };
    return [...bookings].sort((a, b) => lastDate(b).localeCompare(lastDate(a)));
  }, [bookings, flightsByBooking]);

  const save = (b: BookingRow, fields: Record<string, unknown>) =>
    manage.mutate({ id: b.id, fields }, { onSuccess: onChanged });

  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[^0-9.\-]/g, "")) || null);
  // edit PNR text → keep each ref's airline_iata where one exists
  const savePnr = (b: BookingRow, text: string) => {
    const pnrs = text.split(",").map((s) => s.trim()).filter(Boolean);
    const existing = b.booking_refs_airline ?? [];
    const refs = pnrs.map((pnr, i) => ({ airline_iata: existing[i]?.airline_iata ?? "", pnr }));
    save(b, { booking_refs_airline: refs.length ? refs : null });
  };

  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-ink-faint">{bookings.length} bookings</span>
        <Button variant="primary" size="sm" disabled={!canWrite} onClick={() => setAdding(true)}>
          ＋ Add booking
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              <th className={th}>Dates</th>
              <th className={th}>Flights</th>
              <th className={th}>Routes</th>
              <th className={th}>PNR</th>
              <th className={th}>Platform</th>
              <th className={th}>Cash</th>
              <th className={th}>Currency</th>
              <th className={th}>Points</th>
              <th className={th}>Program</th>
              <th className={th}>Emails</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((b) => {
              const fs = flightsByBooking.get(b.id) ?? [];
              const dates = fs.length
                ? fs[0].flight_date === fs[fs.length - 1].flight_date
                  ? fs[0].flight_date
                  : `${fs[0].flight_date} – ${fs[fs.length - 1].flight_date}`
                : "—";
              return (
                <tr key={b.id} className="border-t border-border hover:bg-surface-2/60">
                  <td className={`${td} whitespace-nowrap text-ink-muted`}>{dates}</td>
                  <td className={`${td} font-mono text-ink-muted`}>
                    {fs.length ? fs.map((f) => `${f.airline_iata}${f.flight_number}`).join(", ") : "—"}
                  </td>
                  <td className={`${td} text-ink-muted`}>
                    {fs.length ? fs.map((f) => `${f.dep_iata}→${f.arr_iata}`).join(", ") : "—"}
                  </td>
                  <td className={`${td} font-mono`}>
                    <Cell value={pnrText(b)} canWrite={canWrite} placeholder="add" onSave={(v) => savePnr(b, v)} />
                  </td>
                  <td className={td}>
                    <Cell value={b.booking_platform ?? b.booking_ref_platform ?? ""} canWrite={canWrite} onSave={(v) => save(b, { booking_platform: v || null })} />
                  </td>
                  <td className={`${td} tnum`}>
                    <Cell value={b.cost_cash != null ? String(b.cost_cash) : ""} canWrite={canWrite} numeric onSave={(v) => save(b, { cost_cash: num(v) })} />
                  </td>
                  <td className={td}>
                    <Cell value={b.cost_currency ?? ""} canWrite={canWrite} onSave={(v) => save(b, { cost_currency: v || null })} />
                  </td>
                  <td className={`${td} tnum`}>
                    <Cell value={b.cost_points != null ? String(b.cost_points) : ""} canWrite={canWrite} numeric onSave={(v) => save(b, { cost_points: num(v) })} />
                  </td>
                  <td className={td}>
                    <Cell value={b.points_program ?? ""} canWrite={canWrite} onSave={(v) => save(b, { points_program: v || null })} />
                  </td>
                  <td className={td}>
                    <EmailsCell emails={b.emails} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {adding && (
        <AddBookingModal
          flights={flights}
          onClose={() => setAdding(false)}
          onCreate={(input) =>
            manage.mutate(input, {
              onSuccess: () => {
                onChanged();
                setAdding(false);
              },
            })
          }
          busy={manage.isPending}
        />
      )}
    </div>
  );
}

// Pick one or more un-booked flights and enter the booking's details.
function AddBookingModal({
  flights,
  onClose,
  onCreate,
  busy,
}: {
  flights: Flight[];
  onClose: () => void;
  onCreate: (input: { flight_ids: string[]; fields: Record<string, unknown> }) => void;
  busy: boolean;
}) {
  const unbooked = useMemo(
    () => flights.filter((f) => !f.booking_id).sort((a, b) => b.flight_date.localeCompare(a.flight_date)),
    [flights],
  );
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [q, setQ] = useState("");
  const [fields, setFields] = useState({ pnr: "", platform: "", cash: "", currency: "", points: "", program: "" });
  const set = (k: keyof typeof fields, v: string) => setFields((s) => ({ ...s, [k]: v }));

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return unbooked.slice(0, 200);
    return unbooked
      .filter((f) => `${f.flight_date} ${f.airline_iata}${f.flight_number} ${f.dep_iata} ${f.arr_iata}`.toLowerCase().includes(t))
      .slice(0, 200);
  }, [unbooked, q]);

  const fieldCls = "focus-ring w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-label text-ink placeholder:text-ink-faint";

  const submit = () => {
    const pnrs = fields.pnr.split(",").map((s) => s.trim()).filter(Boolean);
    onCreate({
      flight_ids: [...picked],
      fields: {
        booking_refs_airline: pnrs.length ? pnrs.map((pnr) => ({ airline_iata: "", pnr })) : null,
        booking_platform: fields.platform || null,
        cost_cash: fields.cash.trim() ? Number(fields.cash) || null : null,
        cost_currency: fields.currency || null,
        cost_points: fields.points.trim() ? Number(fields.points) || null : null,
        points_program: fields.program || null,
      },
    });
  };

  return (
    <Modal title="Add booking" onClose={onClose} className="w-[min(720px,95vw)]">
      <div className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <input className={fieldCls} placeholder="PNR(s), comma-sep" value={fields.pnr} onChange={(e) => set("pnr", e.target.value)} />
          <input className={fieldCls} placeholder="Platform (e.g. Amex Travel)" value={fields.platform} onChange={(e) => set("platform", e.target.value)} />
          <input className={fieldCls} placeholder="Program (e.g. Aeroplan)" value={fields.program} onChange={(e) => set("program", e.target.value)} />
          <input className={fieldCls} inputMode="decimal" placeholder="Cash" value={fields.cash} onChange={(e) => set("cash", e.target.value)} />
          <input className={fieldCls} placeholder="Currency (USD)" value={fields.currency} onChange={(e) => set("currency", e.target.value)} />
          <input className={fieldCls} inputMode="decimal" placeholder="Points" value={fields.points} onChange={(e) => set("points", e.target.value)} />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-caption text-ink-muted">Link flights ({picked.size} selected) — only flights without a booking are shown</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="focus-ring w-40 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-caption text-ink placeholder:text-ink-faint" />
          </div>
          <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-border">
            {shown.map((f) => {
              const on = picked.has(f.id);
              return (
                <label key={f.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 text-label last:border-0 hover:bg-surface-2/60">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (n.has(f.id)) n.delete(f.id);
                        else n.add(f.id);
                        return n;
                      })
                    }
                  />
                  <span className="tnum text-ink-muted">{f.flight_date}</span>
                  <span className="font-mono text-ink">{f.airline_iata}{f.flight_number}</span>
                  <span className="text-ink-muted">{f.dep_iata}→{f.arr_iata}</span>
                </label>
              );
            })}
            {shown.length === 0 && <div className="px-3 py-4 text-caption text-ink-faint">No matching un-booked flights.</div>}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || picked.size === 0} onClick={submit}>
            {busy ? "Creating…" : `Create booking${picked.size ? ` (${picked.size} flights)` : ""}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
