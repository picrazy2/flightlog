import { useStore, ALL_TIME, type DateRange } from "@/state/store";
import { Popover } from "@/components/ui/Popover";
import { Switch } from "@/components/ui/Switch";
import { Segmented } from "@/components/ui/Segmented";
import { Icon, Chevron } from "@/components/ui/Icon";
import { useFlights } from "@/data/useFlights";
import { cn } from "@/lib/cn";
import type { StatContext } from "@/stats/types";

const QUARTERS: [string, string][] = [
  ["01-01", "03-31"],
  ["04-01", "06-30"],
  ["07-01", "09-30"],
  ["10-01", "12-31"],
];

function presets(years: number[]): DateRange[] {
  const now = new Date();
  const y = now.getFullYear();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const last12 = new Date(now.getTime());
  last12.setFullYear(y - 1);
  const recent = years.slice().reverse();
  // quarters for the two most recent years with data
  const quarters: DateRange[] = recent.slice(0, 2).flatMap((yr) =>
    QUARTERS.map(([s, e], i) => ({ start: `${yr}-${s}`, end: `${yr}-${e}`, label: `Q${i + 1} ${yr}` })),
  );
  return [
    ALL_TIME,
    { start: `${y}-01-01`, end: iso(now), label: "YTD" },
    { start: iso(last12), end: iso(now), label: "Last 12 months" },
    ...recent.map((yr) => ({ start: `${yr}-01-01`, end: `${yr}-12-31`, label: String(yr) })),
    ...quarters,
  ];
}

export function DateRangePicker(_props: { ctx: StatContext }) {
  const { range, setRange, compare, toggleCompare, temporal, setTemporal } = useStore();
  // presets come from the FULL dataset so they don't vanish when temporal=future filters the view
  const all = useFlights().data ?? [];
  const years = [...new Set(all.map((f) => Number(f.flight_date.slice(0, 4))))].sort();
  const options = presets(years);
  const isAllTime = !range.start && !range.end;
  const pillLabel = isAllTime
    ? temporal === "past"
      ? "Past"
      : temporal === "future"
        ? "Future"
        : "All time"
    : range.label;
  // styled like an active filter chip whenever a range/temporal selection is in effect
  const active = !isAllTime || temporal !== "all";

  return (
    <Popover
      trigger={({ toggle, open }) => (
        <button
          onClick={toggle}
          className={cn(
            "focus-ring inline-flex h-[34px] items-center gap-2 rounded-full border px-3.5 text-label text-ink",
            active
              ? "border-accent bg-[rgba(91,157,255,0.16)] hover:bg-[rgba(91,157,255,0.26)]"
              : "border-border bg-surface-2 hover:bg-surface-3",
            open && !active && "border-border-strong",
          )}
        >
          <Icon name="calendar" size={14} color={active ? "var(--accent)" : "currentColor"} />
          {pillLabel}
          <Chevron dir="down" size={10} color={active ? "var(--accent)" : "var(--ink-faint)"} />
        </button>
      )}
    >
      {(close) => (
        <div className="w-[220px]">
          <Segmented
            aria-label="Time"
            size="sm"
            className="mb-2 w-full"
            value={temporal}
            onChange={(t) => {
              setTemporal(t);
              if (t === "future") setRange(ALL_TIME); // ranges/compare don't apply to future
            }}
            options={[
              { value: "all", label: "All" },
              { value: "past", label: "Past" },
              { value: "future", label: "Future" },
            ]}
          />
          {temporal === "future" ? (
            <p className="px-2.5 py-1 text-caption text-ink-faint">Showing all upcoming flights.</p>
          ) : (
            <>
          <div className="max-h-[280px] overflow-y-auto">
            {options.map((o) => (
              <button
                key={o.label}
                onClick={() => {
                  setRange(o);
                  close();
                }}
                className={cn(
                  "focus-ring block w-full rounded-md px-2.5 py-1.5 text-left text-label hover:bg-surface-2",
                  o.label === range.label ? "text-accent" : "text-ink",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-col gap-1.5 border-t border-border px-2.5 pt-2.5">
            <span className="text-caption text-ink-faint">Custom range</span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={range.start ?? ""}
                onChange={(e) =>
                  setRange({ start: e.target.value || null, end: range.end, label: "Custom" })
                }
                className="focus-ring min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-caption text-ink"
              />
              <span className="text-ink-faint">–</span>
              <input
                type="date"
                value={range.end ?? ""}
                onChange={(e) =>
                  setRange({ start: range.start, end: e.target.value || null, label: "Custom" })
                }
                className="focus-ring min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-caption text-ink"
              />
            </div>
          </div>
          {(range.start || range.end) && (
            <div className="mt-2 flex items-center justify-between border-t border-border px-2.5 pt-2.5">
              <span className="text-label text-ink-muted">Compare to prev.</span>
              <Switch checked={compare} onChange={toggleCompare} />
            </div>
          )}
            </>
          )}
        </div>
      )}
    </Popover>
  );
}
