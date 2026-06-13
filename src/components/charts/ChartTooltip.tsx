import type { TooltipProps } from "recharts";
import { formatDuration, smartNum } from "@/lib/format";

// minutes → standardized "45 min" / "12h 30m" / "3d 4h"; else a magnitude-rounded number
const fmt = (v: number, unit?: string) =>
  unit === "min" ? formatDuration(v).value : `${smartNum(v)}${unit ? ` ${unit}` : ""}`;

// Themed tooltip. `unit` (e.g. "flights", "mi", "min") formats/labels each value.
// `total` adds a summed row — only meaningful for a single-unit stacked bar, so callers
// that mix units/axes (e.g. cost's $ bars + flight-count line) leave it off.
export function ChartTooltip({ active, payload, label, unit, total: showTotal, units, noSwatch }: TooltipProps<number, string> & { unit?: string; total?: boolean; units?: Record<string, string>; noSwatch?: boolean }) {
  if (!active || !payload?.length) return null;
  // a row may carry a `sub` string (e.g. "12 of 34 delayed") shown under the values.
  // Prefer the row's own label (charts keyed on `id` pass the id as `label` otherwise).
  const row = payload[0]?.payload as { sub?: string; label?: string } | undefined;
  const sub = row?.sub;
  const heading = row?.label ?? label;
  // drop zero-value series so a stacked bar's hover only lists the parts it actually has
  const shown = payload.filter((p) => (Number(p.value) || 0) !== 0);
  if (!shown.length) return null;
  // for a genuine stack (2+ parts) also show the combined total
  const total = shown.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 shadow-3">
      <div className="mb-0.5 text-caption text-ink-muted">{heading}</div>
      {shown.map((p) => {
        // a count line (e.g. "Priced flights") is a plain number, not the chart's $/min unit;
        // when the row carries a flightsTotal, show it as "priced / total flights"
        const isCount = p.dataKey === "flights";
        const total = isCount ? (p.payload as { flightsTotal?: number } | undefined)?.flightsTotal : undefined;
        const u = units?.[String(p.dataKey)] ?? (isCount ? "" : unit);
        return (
          <div key={String(p.dataKey)} className="flex items-center gap-2 text-label">
            {!noSwatch && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />}
            <span className="text-ink-muted">{p.name}</span>
            <span className="tnum ml-auto text-ink">
              {isCount ? `${Number(p.value ?? 0).toLocaleString()}${total != null ? ` / ${total.toLocaleString()}` : ""}` : fmt(p.value ?? 0, u)}
            </span>
          </div>
        );
      })}
      {showTotal && shown.length > 1 && (
        <div className="mt-0.5 flex items-center gap-2 border-t border-border pt-0.5 text-label">
          <span className="h-2 w-2" />
          <span className="text-ink-muted">Total</span>
          <span className="tnum ml-auto font-semibold text-ink">{fmt(total, unit)}</span>
        </div>
      )}
      {sub && <div className="mt-0.5 whitespace-pre-line text-caption text-ink-faint">{sub}</div>}
    </div>
  );
}
