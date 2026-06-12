import { cn } from "@/lib/cn";
import { compact } from "@/lib/format";
import type { CardModel, Formatter } from "@/stats/types";
import type { Settings } from "@/lib/types";

interface Props {
  model: CardModel;
  settings: Settings;
  compareMode: "delta" | "recent" | null;
  active: boolean;
  onClick: () => void;
  className?: string;
}

// Period-over-period change as an ABSOLUTE delta in the stat's own units — "+340 km",
// "+12 flights", or for a percentage stat the point change ("+3%"). No change → a dash.
function Compare({
  value,
  compareValue,
  mode,
  format,
  unit,
  settings,
}: {
  value: number;
  compareValue?: number | null;
  mode: "delta" | "recent" | null;
  format?: Formatter;
  unit?: string;
  settings: Settings;
}) {
  if (compareValue == null || mode !== "delta") return null;
  const diff = value - compareValue;
  const fmt = (n: number) => {
    const r = format ? format(n, settings) : { value: compact(n), unit: unit ?? "" };
    // keep only short units (km, mi, %); drop wordy ones (flights, airports, pts…)
    return r.unit && r.unit.length <= 2 ? `${r.value} ${r.unit}` : r.value;
  };
  const shown = fmt(Math.abs(diff));
  if (diff === 0 || shown === "0" || shown === "0%") return <span className="tnum text-caption text-ink-faint">—</span>;
  const up = diff > 0;
  return (
    <span className={cn("tnum text-caption font-medium", up ? "text-positive" : "text-negative")}>
      {up ? "▲" : "▼"} {shown}
    </span>
  );
}

export function StatCard({ model, settings, compareMode, active, onClick, className }: Props) {
  const grouped = model.stats.length > 1;
  return (
    <button
      onClick={onClick}
      className={cn(
        "focus-ring group flex shrink-0 flex-col gap-1.5 rounded-lg border bg-surface-1 px-3.5 py-2.5 text-left shadow-2 transition-[transform,border-color] duration-150 ease-out hover:-translate-y-px",
        active ? "border-accent ring-1 ring-inset ring-accent" : "border-border hover:border-border-strong",
        className,
      )}
    >
      <span className="text-eyebrow tracking-[0.01em] text-ink-faint">{model.eyebrow}</span>
      <div className={cn("flex", grouped ? "items-stretch divide-x divide-border" : "items-end")}>
        {model.stats.map((s, i) => {
          const f = s.format ? s.format(s.value, settings) : { value: compact(s.value), unit: s.unit ?? "" };
          // hover shows the un-abbreviated value (e.g. "$52,345" / "12,345 mi" / "1,234 flights")
          const full = "full" in f && f.full ? f.full : `${s.value.toLocaleString()}${s.unit ? ` ${s.unit}` : ""}`;
          return (
            <div key={i} className={cn("flex flex-col gap-0.5", grouped && (i > 0 ? "pl-2.5" : "pr-2.5"))}>
              <div className="flex items-baseline gap-1" title={full}>
                <span className="tnum font-display text-[1.6rem] font-bold leading-none text-ink">{f.value}</span>
                {grouped && (f.unit || s.unit) && (
                  <span className="whitespace-nowrap text-caption font-medium text-ink-muted">{f.unit || s.unit}</span>
                )}
              </div>
              <Compare value={s.value} compareValue={s.compareValue} mode={compareMode} format={s.format} unit={s.unit} settings={settings} />
            </div>
          );
        })}
      </div>
    </button>
  );
}
