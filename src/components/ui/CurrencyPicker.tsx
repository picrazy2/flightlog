import { useState } from "react";
import { Popover } from "./Popover";
import { Chevron } from "./Icon";
import { useStore } from "@/state/store";
import { useFlights } from "@/data/useFlights";
import { CURRENCIES } from "@/lib/fx";
import { cn } from "@/lib/cn";

// Currencies ordered by how many of your bookings were paid in each (most-used first).
function useCurrencyOrder() {
  const flights = useFlights().data;
  const count = new Map<string, number>();
  const seen = new Set<string>();
  for (const f of flights ?? []) {
    if (!f.booking_id || seen.has(f.booking_id)) continue;
    seen.add(f.booking_id);
    const c = (f.cost_currency ?? "").toUpperCase();
    if (c) count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...CURRENCIES].sort((a, b) => (count.get(b.code) ?? 0) - (count.get(a.code) ?? 0));
}

// Searchable currency list (shared by the desktop dropdown + mobile inline picker).
function List({ current, onPick }: { current: string; onPick: (code: string) => void }) {
  const [q, setQ] = useState("");
  const ordered = useCurrencyOrder();
  const t = q.trim().toLowerCase();
  const items = ordered.filter((c) => !t || c.code.toLowerCase().includes(t) || c.name.toLowerCase().includes(t));
  return (
    <div className="w-[230px]">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search currency…"
        className="focus-ring mb-1.5 w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-label text-ink placeholder:text-ink-faint"
      />
      <ul className="max-h-[260px] overflow-y-auto">
        {items.map((c) => (
          <li key={c.code}>
            <button
              onClick={() => onPick(c.code)}
              className={cn(
                "focus-ring flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-label hover:bg-surface-2",
                c.code === current ? "text-accent" : "text-ink",
              )}
            >
              <span className="min-w-0 truncate">
                <span className="font-medium">{c.code}</span> <span className="text-ink-faint">{c.name}</span>
              </span>
              {c.code === current && <span className="shrink-0 text-accent">✓</span>}
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="px-2 py-2 text-caption text-ink-faint">No match</li>}
      </ul>
    </div>
  );
}

// Desktop: a small button showing the active code that opens a floating searchable list.
export function CurrencyButton() {
  const cur = useStore((s) => s.settings.currency);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <Popover
      align="end"
      trigger={({ toggle, open }) => (
        <button
          onClick={toggle}
          aria-label="Display currency"
          title="Display currency"
          className={cn(
            "focus-ring inline-flex h-9 items-center gap-1 rounded-md px-2 text-label font-semibold text-ink hover:bg-surface-2",
            open && "bg-surface-2",
          )}
        >
          {cur}
          <Chevron dir={open ? "up" : "down"} size={10} color="var(--ink-faint)" />
        </button>
      )}
    >
      {(close) => <List current={cur} onPick={(c) => { setSettings({ currency: c }); close(); }} />}
    </Popover>
  );
}

// Mobile: a row that expands an inline searchable list (avoids nesting popovers).
export function CurrencyInline() {
  const cur = useStore((s) => s.settings.currency);
  const setSettings = useStore((s) => s.setSettings);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex w-full items-center justify-between rounded-md px-1 py-1.5 text-label text-ink hover:bg-surface-2"
      >
        <span>Currency</span>
        <span className="flex items-center gap-1 text-accent">{cur} <Chevron dir={open ? "up" : "down"} size={10} color="currentColor" /></span>
      </button>
      {open && <div className="mt-1">{<List current={cur} onPick={(c) => { setSettings({ currency: c }); setOpen(false); }} />}</div>}
    </div>
  );
}
