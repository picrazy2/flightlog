// Shared Recharts styling so every chart inherits the design tokens.
export const CHART = {
  grid: "rgba(255,255,255,0.06)",
  axis: "#5C6575",
  axisText: "#98A2B3",
  cursor: "rgba(255,255,255,0.06)",
} as const;

export const axisTick = { fill: CHART.axisText, fontSize: 11, fontFamily: "Geist, sans-serif" };

export interface Series {
  key: string;
  name: string;
  color: string;
}
