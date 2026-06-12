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
  title?: string; // header for the "see all" modal
}

// Shared entity visual: horizontal stacked bars OR a top-N + "Other" donut.
// The pie value for each row is the sum of all bar series (i.e. its total).
export function EntityChart({ rows, series, chartType, onPick, activeId, unit, percent, tickIcon, topPie = 9, cap = 8, title }: Props) {
  // when the breakdown collapses to a single non-empty series, force the donut — lone
  // stacked bars carry no more information than a share-of-total pie of the same rows
  const liveSeries = series.filter((s) => rows.some((r) => (Number(r[s.key]) || 0) > 0));
  if (chartType === "pie" || (!percent && liveSeries.length <= 1)) {
    const totals = rows
      .map((r) => ({ id: r.id, label: r.label, value: series.reduce((s, k) => s + (Number(r[k.key]) || 0), 0) }))
      .sort((a, b) => b.value - a.value);
    const top = totals.slice(0, topPie);
    const rest = totals.slice(topPie);
    const slices: Slice[] = top.map((t, i) => ({ ...t, color: CATEGORICAL[i % CATEGORICAL.length] }));
    const otherSum = rest.reduce((s, t) => s + t.value, 0);
    if (otherSum > 0) slices.push({ id: "__other", label: "Other", value: otherSum, color: OTHER_COLOR });
    return <PieSlices slices={slices} unit={unit} activeId={activeId} onPick={(id) => id !== "__other" && onPick?.(id)} />;
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
      title={title}
      onPick={onPick}
    />
  );
}
