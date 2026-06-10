import { cn } from "@/lib/cn";
import { compact, deltaPct } from "@/lib/format";
import type { CardModel } from "@/stats/types";
import type { Settings } from "@/lib/types";

interface Props {
  model: CardModel;
  settings: Settings;
  compareMode: "delta" | "recent" | null;
  active: boolean;
  onClick: () => void;
}

function Compare({
  value,
  compareValue,
  mode,
}: {
  value: number;
  compareValue?: number | null;
  mode: "delta" | "recent" | null;
}) {
  if (compareValue == null || mode !== "delta") return null;
  const pct = deltaPct(value, compareValue);
  if (pct == null || Math.abs(pct) < 0.5) return <span className="tnum text-caption text-ink-faint">±0%</span>;
  const up = pct > 0;
  return (
    <span className={cn("tnum text-caption font-medium", up ? "text-positive" : "text-negative")}>
      {up ? "▲" : "▼"} {Math.abs(Math.round(pct))}%
    </span>
  );
}

export function StatCard({ model, settings, compareMode, active, onClick }: Props) {
  const grouped = model.stats.length > 1;
  return (
    <button
      onClick={onClick}
      className={cn(
        "focus-ring group flex shrink-0 flex-col gap-1.5 rounded-lg border bg-surface-1 px-3.5 py-2.5 text-left shadow-2 transition-[transform,border-color] duration-150 ease-out hover:-translate-y-px",
        active ? "border-accent ring-1 ring-inset ring-accent" : "border-border hover:border-border-strong",
      )}
    >
      <span className="text-eyebrow tracking-[0.01em] text-ink-faint">{model.eyebrow}</span>
      <div className={cn("flex", grouped ? "items-stretch divide-x divide-border" : "items-end")}>
        {model.stats.map((s, i) => {
          const f = s.format ? s.format(s.value, settings) : { value: compact(s.value), unit: s.unit ?? "" };
          return (
            <div key={i} className={cn("flex flex-col gap-0.5", grouped && (i > 0 ? "pl-2.5" : "pr-2.5"))}>
              <div className="flex items-baseline gap-1">
                <span className="tnum font-display text-[1.6rem] font-bold leading-none text-ink">{f.value}</span>
                {grouped && (f.unit || s.unit) && (
                  <span className="whitespace-nowrap text-caption font-medium text-ink-muted">{f.unit || s.unit}</span>
                )}
              </div>
              <Compare value={s.value} compareValue={s.compareValue} mode={compareMode} />
            </div>
          );
        })}
      </div>
    </button>
  );
}
