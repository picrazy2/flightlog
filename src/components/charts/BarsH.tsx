import { useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, axisTick, type Series } from "./chartTheme";
import { formatDuration } from "@/lib/format";
import { ChartTooltip } from "./ChartTooltip";
import { ChartLegend } from "./ChartLegend";
import { PieSlices, type Slice } from "./Pie";
import { makeBarShape } from "./stackedBarShape";
import { useIsMobile } from "@/lib/useIsMobile";
import { Modal } from "@/components/ui/Modal";
import { CATEGORICAL, OTHER_KEY, OTHER_COLOR } from "@/lib/palette";

export interface BarRowData {
  id: string;
  label: string;
  [series: string]: string | number;
}

interface Props {
  rows: BarRowData[];
  series: Series[];
  percent?: boolean; // 100% stacked
  onPick?: (id: string) => void;
  activeId?: string | null | string[]; // single id, or a set of selected ids (multi-select)
  height?: number;
  tickIcon?: (row: BarRowData) => string | undefined; // optional logo per row (airlines)
  tickBadge?: (row: BarRowData) => { color: string } | undefined; // colored dot beside label
  colorByRow?: (row: BarRowData) => string | undefined; // per-bar color (single-series)
  unit?: string; // tooltip unit suffix
  cap?: number; // show only the first `cap` rows, with a "see all" button that opens a modal
  barSize?: number; // fixed bar thickness (px); default lets recharts size it
  rowPx?: number; // vertical space per row (px); default 26 — smaller = skinnier/tighter
  labelWidth?: number; // override the category-label column width (px)
  tickFontSize?: number; // override the category-label font size (px)
  topAxis?: boolean; // put the value axis at the top (visible above a tall scrolling list)
  autoPie?: boolean; // when a stacked breakdown collapses to one series, draw a donut of the rows
  title?: string; // header for the "see all" modal
  valueLabels?: boolean; // print each row's total at the end of its bar
  stickyAxis?: boolean; // pin the value axis above the bars (for tall, scrolling lists)
}

// Horizontal, optionally stacked / 100%-stacked, interactive bar chart.
export function BarsH({ rows, series, percent, onPick, activeId, height, tickIcon, tickBadge, colorByRow, unit, cap, barSize, rowPx, labelWidth, tickFontSize, topAxis, autoPie, title, valueLabels, stickyAxis }: Props) {
  // on touch (mobile/tablet) a tap is the only way to see a value, so don't let it filter
  const pick = useIsMobile(1024) ? undefined : onPick;
  const [showAll, setShowAll] = useState(false); // opens the "see all" modal
  const hasMore = cap != null && rows.length > cap;
  const shown = hasMore ? rows.slice(0, cap!) : rows;
  const data = percent
    ? shown.map((r) => {
        const total = series.reduce((s, k) => s + (Number(r[k.key]) || 0), 0) || 1;
        const out: BarRowData = { id: r.id, label: r.label };
        for (const k of series) out[k.key] = ((Number(r[k.key]) || 0) / total) * 100;
        return out;
      })
    : shown;

  const h = height ?? Math.max(120, shown.length * (rowPx ?? 26) + 24);

  // One formatter for the axis ticks and the end-of-bar labels, so they can't disagree.
  const fmtValue = percent
    ? (v: number) => `${Math.round(v)}%`
    : unit === "min"
      ? (v: number) => formatDuration(v).value
      : (v: number) => v.toLocaleString();
  const rowTotal = (r: BarRowData) => series.reduce((sum, k) => sum + (Number(r[k.key]) || 0), 0);
  // A sticky axis renders in its own chart, so both charts need the same explicit domain —
  // left to auto-scale they would "nice" their bounds separately and drift out of line.
  const maxTotal = Math.max(0, ...data.map(rowTotal));
  const axisDomain: [number, number] = percent ? [0, 100] : [0, maxTotal || 1];
  const labelW = labelWidth ?? (tickIcon ? 76 : 92);
  const chartMargin = { left: 4, right: valueLabels ? 52 : 8, top: 2, bottom: 2 };

  // a single bar with a breakdown reads better as a donut of its composition
  if (rows.length === 1 && series.length > 1 && !percent) {
    const r = rows[0];
    const slices = series
      .map((s) => ({ id: s.key, label: s.name, value: Number(r[s.key]) || 0, color: s.color }))
      .filter((s) => s.value > 0);
    return (
      <div>
        <div className="mb-1 text-eyebrow tracking-[0.01em] text-ink-faint">{r.label}</div>
        <PieSlices slices={slices} unit={unit} />
      </div>
    );
  }

  // a breakdown that has collapsed to a single non-empty series is just a share-of-total
  // across the rows → draw it as a donut (top `cap` slices + Other) instead of lone bars
  const liveSeries = series.filter((s) => rows.some((r) => (Number(r[s.key]) || 0) > 0));
  if (autoPie && !percent && liveSeries.length <= 1 && rows.length > 1) {
    const key = (liveSeries[0] ?? series[0]).key;
    const sorted = rows
      .map((r) => ({ id: String(r.id), label: r.label, value: Number(r[key]) || 0, byColor: colorByRow?.(r) }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    const lim = cap ?? 9;
    const slices: Slice[] = sorted.slice(0, lim).map((t, i) => ({ id: t.id, label: t.label, value: t.value, color: t.byColor ?? CATEGORICAL[i % CATEGORICAL.length] }));
    const otherSum = sorted.slice(lim).reduce((s, t) => s + t.value, 0);
    if (otherSum > 0) slices.push({ id: OTHER_KEY, label: "Other", value: otherSum, color: OTHER_COLOR });
    return <PieSlices slices={slices} unit={unit} activeId={activeId} onPick={onPick ? (id) => id !== OTHER_KEY && onPick(id) : undefined} />;
  }

  // bars coloured per-row (colorByRow) → the series-based legend + tooltip swatch would
  // show the wrong colour, so suppress them (callers supply their own legend if needed)
  const perRowColored = Boolean(colorByRow);

  // Printed past the end of the last stack segment, so for a stacked row it lands at the
  // row total rather than at the final series' own value.
  // recharts hands label content its geometry as string | number, so coerce before maths.
  const ValueLabel = (props: {
    x?: string | number;
    y?: string | number;
    width?: string | number;
    height?: string | number;
    index?: number;
  }) => {
    const row = data[props.index ?? -1];
    if (!row) return null;
    const x = Number(props.x ?? 0) + Number(props.width ?? 0) + 6;
    const y = Number(props.y ?? 0) + Number(props.height ?? 0) / 2;
    return (
      <text x={x} y={y} dy={4} textAnchor="start" fill={axisTick.fill} fontSize={axisTick.fontSize}>
        {fmtValue(rowTotal(row))}
      </text>
    );
  };

  return (
    <div>
      {!perRowColored && <ChartLegend series={series} />}
      {stickyAxis && (
        // The value axis lives in its own chart pinned to the top of the scroll container:
        // inside a tall list the real axis sits at the far end, so reading a bar means
        // scrolling to the bottom and back. Shares axisDomain/labelW with the bars below
        // so the two grids line up exactly.
        <div className="sticky top-0 z-10 -mx-4 mb-1 border-b border-border bg-surface-1/95 px-4 pt-1 backdrop-blur-sm">
          <div style={{ height: 26 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={data} margin={chartMargin}>
                <XAxis
                  type="number"
                  orientation="top"
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  domain={axisDomain}
                  allowDataOverflow
                  tickFormatter={(v) => fmtValue(Number(v))}
                />
                <YAxis type="category" dataKey="label" width={labelW} tick={false} axisLine={false} tickLine={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="transition-[height] duration-300 ease-out" style={{ height: h, cursor: pick ? "pointer" : undefined }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={data}
          margin={chartMargin}
          barCategoryGap={6}
          onClick={pick ? (s: { activeTooltipIndex?: number | null } | null) => {
            const i = s?.activeTooltipIndex;
            if (i != null && i >= 0 && data[i]) pick(data[i].id);
          } : undefined}
        >
          <CartesianGrid horizontal={false} stroke={CHART.grid} />
          <XAxis
            type="number"
            orientation={topAxis ? "top" : "bottom"}
            hide={stickyAxis}
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            domain={axisDomain}
            allowDataOverflow
            tickFormatter={(v) => fmtValue(Number(v))}
          />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval={0}
            width={labelW}
            tick={
              tickBadge
                ? (props: { x: number; y: number; payload: { index: number } }) => {
                    const row = data[props.payload.index];
                    const badge = row && tickBadge(row);
                    return (
                      <g transform={`translate(${props.x},${props.y})`}>
                        {badge && <circle cx={-7} cy={0} r={3.5} fill={badge.color} />}
                        <text x={badge ? -16 : -6} y={0} dy={4} textAnchor="end" fill={axisTick.fill} fontSize={axisTick.fontSize}>
                          {row?.label}
                        </text>
                      </g>
                    );
                  }
                : tickIcon
                ? (props: { x: number; y: number; payload: { index: number } }) => {
                    const row = data[props.payload.index];
                    const logo = row && tickIcon(row);
                    // logo recoloured to light grey (via filter) so it needs no chip
                    return (
                      <g transform={`translate(${props.x},${props.y})`}>
                        {logo ? (
                          <image href={logo} x={-61} y={-12} width={52} height={24} preserveAspectRatio="xMidYMid meet" style={{ filter: "brightness(0) invert(0.9)" }} />
                        ) : (
                          <text x={-6} y={0} dy={4} fill={axisTick.fill} fontSize={axisTick.fontSize} textAnchor="end">
                            {row?.label}
                          </text>
                        )}
                      </g>
                    );
                  }
                : (tickFontSize ? { ...axisTick, fontSize: tickFontSize } : axisTick)
            }
          />
          <Tooltip content={<ChartTooltip unit={unit} total noSwatch={perRowColored} />} cursor={{ fill: CHART.cursor }} />
          {series.map((s, si) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="a"
              fill={s.color}
              isAnimationActive={false}
              barSize={barSize}
              cursor={pick ? "pointer" : undefined}
              shape={makeBarShape({ keys: series.map((x) => x.key), thisKey: s.key, axis: "x", color: s.color, activeId, colorByRow, baseOpacity: s.opacity })}
            >
              {valueLabels && si === series.length - 1 && <LabelList content={ValueLabel} />}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      </div>
      {hasMore && (
        <button
          onClick={() => setShowAll(true)}
          className="focus-ring mt-1 px-1.5 text-caption text-accent hover:underline"
        >
          See all {rows.length}
        </button>
      )}
      {showAll && (
        <Modal title={title ?? "All results"} onClose={() => setShowAll(false)} className="w-[min(560px,95vw)]">
          <div className="overflow-y-auto p-4" style={{ maxHeight: "75vh" }}>
            <BarsH
              rows={rows}
              series={series}
              percent={percent}
              onPick={onPick}
              activeId={activeId}
              tickIcon={tickIcon}
              tickBadge={tickBadge}
              colorByRow={colorByRow}
              unit={unit}
              barSize={barSize}
              rowPx={rowPx}
              valueLabels
              stickyAxis
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
