// Categorical palette (see DESIGN_SYSTEM.md §3) — legible on --bg, colorblind-aware.
export const CATEGORICAL = [
  "#5B9DFF",
  "#FFC061",
  "#34D399",
  "#FB7185",
  "#A78BFA",
  "#22D3EE",
  "#F472B6",
  "#A3E635",
  "#FB923C",
  "#818CF8",
] as const;

export const color = {
  accent: "#5B9DFF",
  secondary: "#FFC061",
  upcoming: "#2DD4BF", // not-yet-flown (future) flights

  routeDomestic: "#34D399",
  routeIntl: "#FB7185",
  airport: "#CBD5E1",
  ink: "#EAEDF3",
  inkMuted: "#98A2B3",
  border: "rgba(255,255,255,0.08)",
} as const;

// The "Other" bucket every top-N chart folds its tail into. Deliberately a desaturated
// slate that reads as "not one of the named series" against the categorical palette.
export const OTHER_KEY = "__other";
export const OTHER_COLOR = "#475569";

// Stable color for a categorical series by its rank index (year, country, airline…).
export function categoricalFor(_key: string, index: number): string {
  return CATEGORICAL[index % CATEGORICAL.length];
}

// Sequential ramp for choropleth: t in [0,1] → hex between dark and bright sky.
export function sequential(t: number): string {
  const stops = [
    [14, 42, 63], // #0E2A3F
    [91, 157, 255], // #5B9DFF
    [191, 224, 255], // #BFE0FF
  ];
  const clamped = Math.max(0, Math.min(1, t));
  const seg = clamped < 0.5 ? 0 : 1;
  const local = clamped < 0.5 ? clamped / 0.5 : (clamped - 0.5) / 0.5;
  const [a, b] = [stops[seg], stops[seg + 1]];
  const mix = a.map((v, i) => Math.round(v + (b[i] - v) * local));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}
