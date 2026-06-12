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

const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const fmtDay = (iso: string, withYear = false) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
const fmtMonth = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString([], { month: "short", year: "numeric" });

// compact "Mar 1 – Apr 15" (adds years when they differ)
function compactRange(start: string | null, end: string | null): string {
  if (!start && !end) return "All time";
  if (start && end) {
    const sameYear = start.slice(0, 4) === end.slice(0, 4);
    return `${fmtDay(start, !sameYear)} – ${fmtDay(end, true)}`;
  }
  return start ? `From ${fmtDay(start, true)}` : `Until ${fmtDay(end!, true)}`;
}

// the immediately-preceding equal-length window (matches context.ts compare logic)
function prevPeriod(start: string | null, end: string | null): { start: string; end: string } | null {
  if (!start || !end) return null;
  const s = new Date(`${start}T00:00:00`).getTime();
  const span = new Date(`${end}T00:00:00`).getTime() - s;
  return { start: isoOf(new Date(s - 86_400_000 - span)), end: isoOf(new Date(s - 86_400_000)) };
}

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
  const { range, setRange, compare, toggleCompare, setCompare, temporal, setTemporal } = useStore();
  // presets come from the FULL dataset so they don't vanish when temporal=future filters the view
  const all = useFlights().data ?? [];
  const years = [...new Set(all.map((f) => Number(f.flight_date.slice(0, 4))))].sort();
  const options = presets(years);
  const isAllTime = !range.start && !range.end;
  // effective span of all logged flights → shown on the All-time option
  const dates = all.map((f) => f.flight_date);
  const firstDate = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
  const lastDate = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  const allTimeSpan = firstDate && lastDate ? `${fmtMonth(firstDate)} – ${fmtMonth(lastDate)}` : null;
  // custom ranges show their dates compactly in the pill instead of "Custom"
  const pillLabel = isAllTime
    ? temporal === "past"
      ? "Past"
      : temporal === "future"
        ? "Future"
        : "All time"
    : range.label === "Custom"
      ? compactRange(range.start, range.end)
      : range.label;
  const prev = compare ? prevPeriod(range.start, range.end) : null;
  // styled like an active filter chip whenever a range/temporal selection is in effect
  const active = !isAllTime || temporal !== "all";

  return (
    <Popover
      trigger={({ toggle, open }) => (
        <span
          className={cn(
            "inline-flex h-10 items-center rounded-full border text-label text-ink md:h-[34px]",
            active ? "gap-1.5 border-accent bg-[#172338] pl-3.5 pr-1.5 hover:bg-[#1f3250]" : "gap-2 border-border bg-surface-1 px-3.5 hover:bg-surface-2",
            open && !active && "border-border-strong",
          )}
        >
          <button onClick={toggle} className="focus-ring inline-flex items-center gap-2">
            <Icon name="calendar" size={14} color={active ? "var(--accent)" : "currentColor"} />
            {pillLabel}
            {!active && <Chevron dir="down" size={10} color="var(--ink-faint)" />}
          </button>
          {active && (
            <button
              onClick={() => {
                setRange(ALL_TIME);
                setTemporal("all");
              }}
              aria-label="Reset to All time"
              className="focus-ring grid h-5 w-5 place-items-center rounded-full text-accent/70 hover:bg-[rgba(91,157,255,0.2)] hover:text-accent"
            >
              ✕
            </button>
          )}
        </span>
      )}
    >
      {(close) => (
        <div className="w-[252px]">
          <Segmented
            aria-label="Time"
            size="sm"
            className="mb-2 w-full"
            value={temporal}
            onChange={(t) => {
              setTemporal(t);
              if (t === "future") setRange(ALL_TIME); // ranges don't apply to future
              setCompare(false); // all-time / past / future default to no comparison
            }}
            options={[
              { value: "all", label: "All" },
              { value: "past", label: "Past" },
              { value: "future", label: "Future" },
            ]}
          />
          {temporal === "future" ? (
            <div className="px-2.5 py-1">
              <p className="text-caption text-ink-faint">Showing all upcoming flights.</p>
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2.5">
                <span className="text-label text-ink-muted">Compare to past</span>
                <Switch checked={compare} onChange={toggleCompare} />
              </div>
              {compare && <span className="text-caption text-ink-faint">Deltas are future vs everything flown.</span>}
            </div>
          ) : (
            <>
          <div className="max-h-[280px] overflow-y-auto">
            {options.map((o) => {
              const isAllTimeOpt = !o.start && !o.end;
              return (
                <button
                  key={o.label}
                  onClick={() => {
                    setRange(o);
                    setCompare(!!(o.start || o.end)); // bounded → compare on; All time → off
                    close();
                  }}
                  className={cn(
                    "focus-ring flex w-full items-baseline justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-label hover:bg-surface-2",
                    o.label === range.label ? "text-accent" : "text-ink",
                  )}
                >
                  <span>{o.label}</span>
                  {isAllTimeOpt && allTimeSpan && <span className="text-caption text-ink-faint">{allTimeSpan}</span>}
                </button>
              );
            })}
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
          {(range.start || range.end || (isAllTime && temporal === "all")) && (
            <div className="mt-2 flex flex-col gap-1 border-t border-border px-2.5 pt-2.5">
              <div className="flex items-center justify-between">
                <span className="text-label text-ink-muted">{isAllTime ? "Compare to past" : "Compare to prev."}</span>
                <Switch checked={compare} onChange={toggleCompare} />
              </div>
              {compare &&
                (isAllTime ? (
                  <span className="text-caption text-ink-faint">All-time vs everything flown so far.</span>
                ) : (
                  prev && <span className="text-caption text-ink-faint">vs {compactRange(prev.start, prev.end)}</span>
                ))}
            </div>
          )}
            </>
          )}
        </div>
      )}
    </Popover>
  );
}
