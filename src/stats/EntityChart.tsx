import { BarsH, type BarRowData } from "@/components/charts/BarsH";
import { PieSlices, type Slice } from "@/components/charts/Pie";
import { CATEGORICAL } from "@/lib/palette";
import type { Series } from "@/components/charts/chartTheme";
import type { ChartType } from "./useChartType";

const OTHER_COLOR = "#475569";

interface Props {
  rows: BarRowData[];
  series: Series[]; // bar series (one for single-value, many for stacked)
  chartType: ChartType;
  onPick?: (id: string) => void;
  activeId?: string | null | string[];
  unit?: string;
  percent?: boolean; // 100%-stacked bar
  tickIcon?: (row: BarRowData) => string | undefined;
  topPie?: number; // top N slices before "Other"
  cap?: number; // bar: show top N rows with a "see all" toggle
}

// Shared entity visual: horizontal stacked bars OR a top-N + "Other" donut.
// The pie value for each row is the sum of all bar series (i.e. its total).
export function EntityChart({ rows, series, chartType, onPick, activeId, unit, percent, tickIcon, topPie = 9, cap = 12 }: Props) {
  if (chartType === "pie") {
    const totals = rows
      .map((r) => ({ id: r.id, label: r.label, value: series.reduce((s, k) => s + (Number(r[k.key]) || 0), 0) }))
      .sort((a, b) => b.value - a.value);
    const top = totals.slice(0, topPie);
    const rest = totals.slice(topPie);
    const slices: Slice[] = top.map((t, i) => ({ ...t, color: CATEGORICAL[i % CATEGORICAL.length] }));
    const otherSum = rest.reduce((s, t) => s + t.value, 0);
    if (otherSum > 0) slices.push({ id: "__other", label: "Other", value: otherSum, color: OTHER_COLOR });
    return <PieSlices slices={slices} unit={unit} onPick={(id) => id !== "__other" && onPick?.(id)} />;
  }
  return (
    <BarsH
      rows={rows}
      series={series}
      percent={percent}
      activeId={activeId}
      unit={unit}
      tickIcon={tickIcon}
      cap={cap}
      onPick={onPick}
    />
  );
}
