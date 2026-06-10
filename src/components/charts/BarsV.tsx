import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, axisTick, type Series } from "./chartTheme";
import { formatDuration } from "@/lib/format";
import { ChartTooltip } from "./ChartTooltip";
import { ChartLegend } from "./ChartLegend";
import { makeBarShape } from "./stackedBarShape";
import { useIsMobile } from "@/lib/useIsMobile";
import type { BarRowData } from "./BarsH";

interface Props {
  rows: BarRowData[];
  series: Series[];
  percent?: boolean;
  onPick?: (id: string) => void;
  activeId?: string | null;
  height?: number;
  colorByRow?: (row: BarRowData) => string | undefined; // override per-bar fill (e.g. future)
  unit?: string;
}

// Vertical bars for time series (by year / month / weekday / hour).
export function BarsV({ rows, series, percent, onPick, activeId, height, colorByRow, unit }: Props) {
  // on mobile a tap is the only way to read a value (no hover), so don't let it filter
  const pick = useIsMobile() ? undefined : onPick;
  const data = percent
    ? rows.map((r) => {
        const total = series.reduce((s, k) => s + (Number(r[k.key]) || 0), 0) || 1;
        const out: BarRowData = { id: r.id, label: r.label };
        for (const k of series) out[k.key] = ((Number(r[k.key]) || 0) / total) * 100;
        return out;
      })
    : rows;

  // category by unique id (labels may repeat or be blank, e.g. season timeline)
  const labelById = new Map(rows.map((r) => [r.id, r.label]));
  return (
    <div>
      <ChartLegend series={series} />
      <div style={{ height: height ?? 180, cursor: pick ? "pointer" : undefined }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ left: -16, right: 4, top: 4, bottom: 2 }}
          barCategoryGap="8%"
          onClick={pick ? (s: { activeTooltipIndex?: number | null } | null) => {
            const i = s?.activeTooltipIndex;
            if (i != null && i >= 0 && data[i]) pick(data[i].id);
          } : undefined}
        >
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis
            dataKey="id"
            tickFormatter={(id) => labelById.get(String(id)) ?? ""}
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            domain={percent ? [0, 100] : undefined}
            tickFormatter={percent ? (v) => `${v}%` : unit === "min" ? (v) => formatDuration(Number(v)).value : (v) => Number(v).toLocaleString()}
          />
          <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: CHART.cursor }} />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="a"
              fill={s.color}
              isAnimationActive={false}
              cursor={pick ? "pointer" : undefined}
              shape={makeBarShape({ keys: series.map((x) => x.key), thisKey: s.key, axis: "y", color: s.color, activeId, colorByRow })}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
