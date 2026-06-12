import type { BarRowData } from "./BarsH";

interface ShapeOpts {
  keys: string[];
  thisKey: string;
  axis: "x" | "y"; // x = horizontal bars, y = vertical
  color: string;
  activeId?: string | null | string[]; // a single id or a set of selected ids (multi-select)
  colorByRow?: (row: BarRowData) => string | undefined;
  baseOpacity?: number; // per-series opacity (e.g. a lighter "extra" segment of the same color)
}

interface RechartsShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: BarRowData;
}

// Rounds the two corners on one side: right/left (horizontal) or top/bottom (vertical).
type Side = "right" | "left" | "top" | "bottom";
function path(x: number, y: number, w: number, h: number, r: number, side: Side) {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
  switch (side) {
    case "right":
      return `M${x},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}L${x},${y + h}Z`;
    case "left":
      return `M${x + r},${y}L${x + w},${y}L${x + w},${y + h}L${x + r},${y + h}Q${x},${y + h} ${x},${y + h - r}L${x},${y + r}Q${x},${y} ${x + r},${y}Z`;
    case "top":
      return `M${x},${y + r}Q${x},${y} ${x + r},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${y + h}L${x},${y + h}Z`;
    case "bottom":
      return `M${x},${y}L${x + w},${y}L${x + w},${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}L${x + r},${y + h}Q${x},${y + h} ${x},${y + h - r}L${x},${y}Z`;
  }
}

// Custom Bar shape: rounds the OUTER corner of the last non-zero segment in each
// stack (so the visible end of every bar is rounded). Handles negative values
// (diverging bars) by rounding the end away from the zero baseline.
export function makeBarShape(opts: ShapeOpts) {
  return (props: RechartsShapeProps) => {
    let { x = 0, y = 0, width = 0, height = 0 } = props;
    const { payload } = props;
    const negative = opts.axis === "x" ? width < 0 : height < 0;
    // negative values arrive as a negative width/height — normalize so the bar
    // still renders (extending the other way from the baseline)
    if (width < 0) {
      x += width;
      width = -width;
    }
    if (height < 0) {
      y += height;
      height = -height;
    }
    if (width <= 0 || height <= 0) return <g />;
    const lastNonZero = [...opts.keys].reverse().find((k) => Number(payload?.[k] ?? 0) !== 0);
    const round = lastNonZero === opts.thisKey;
    // clamp the corner radius by BOTH dimensions so a thin bar doesn't get a
    // degenerate (invisible) rounded path
    const r = round ? Math.min(4, width / 2, height / 2) : 0;
    const side: Side = opts.axis === "x" ? (negative ? "left" : "right") : negative ? "bottom" : "top";
    const fill = (payload && opts.colorByRow?.(payload)) ?? opts.color;
    const active = opts.activeId;
    const hasActive = Array.isArray(active) ? active.length > 0 : active != null;
    const isActive = Array.isArray(active) ? active.includes(payload?.id ?? "") : payload?.id === active;
    const opacity = (hasActive && !isActive ? 0.35 : 1) * (opts.baseOpacity ?? 1);
    return <path d={path(x, y, width, height, r, side)} fill={fill} fillOpacity={opacity} />;
  };
}
