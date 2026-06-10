import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, axisTick, type Series } from "./chartTheme";
import { ChartTooltip } from "./ChartTooltip";
import { ChartLegend } from "./ChartLegend";
import type { BarRowData } from "./BarsH";

export interface ChartBand {
  x1: string; // inclusive category label
  x2: string; // inclusive category label
  color: string; // fill (include alpha)
}

interface Props {
  rows: BarRowData[];
  series: Series[];
  height?: number;
  yFormat?: (v: number) => string;
  unit?: string;
  syncId?: string; // share hover across charts with the same id
  bands?: ChartBand[]; // faint x-axis background regions
}

// Multi-series line chart (time-of-day dep/arr, delays over time…).
export function Lines({ rows, series, height, yFormat, unit, syncId, bands }: Props) {
  return (
    <div>
      <ChartLegend series={series} />
      <div style={{ height: height ?? 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ left: -12, right: 8, top: 6, bottom: 2 }} syncId={syncId}>
          <CartesianGrid stroke={CHART.grid} />
          {bands?.map((b, i) => (
            <ReferenceArea key={i} x1={b.x1} x2={b.x2} fill={b.color} fillOpacity={1} stroke="none" ifOverflow="extendDomain" />
          ))}
          <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
          <YAxis
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            tickFormatter={yFormat ? (v) => yFormat(Number(v)) : (v) => Number(v).toLocaleString()}
          />
          <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ stroke: CHART.grid }} />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
