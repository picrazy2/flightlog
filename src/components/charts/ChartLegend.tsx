import type { Series } from "./chartTheme";

// Small inline legend for multi-series charts (grouped/stacked bars, multi-line).
export function ChartLegend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5 text-caption text-ink-muted">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}
