import type { StatContext } from "@/stats/types";

// The flat map is framed so the two antimeridians sit at the left/right edges (the whole
// world width), centred on the prime meridian at the Tropic of Cancer. That only looks
// right when the viewport is wide enough that the top edge stays at/below the pole; on a
// taller window we'd overshoot the pole, so we open the globe instead.

export const TROPIC_OF_CANCER = 23.4366; // °N

// Web-Mercator y of a latitude, normalised to [0,1] (0 = north edge ~85.05°, 1 = south).
const mercatorY = (lat: number) => (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;

// At the zoom that fits the world width, the viewport's half-height (normalised) is H/2W.
// The top stays within the world when H/2W ≤ mercatorY(centre), i.e. W/H ≥ 1/(2·mercY).
// With the centre at the Tropic of Cancer this threshold is ≈ 1.15.
export const flatFitsViewport = (w: number, h: number) => w / h >= 1 / (2 * mercatorY(TROPIC_OF_CANCER));

export interface InitialView {
  projection: "mercator" | "globe";
  center: [number, number];
  zoom: number;
}

export function computeInitialView(w: number, h: number, ctx: StatContext): InitialView {
  if (flatFitsViewport(w, h)) {
    // mercator world width = 512·2^zoom px → set it equal to the viewport width so the
    // antimeridians land exactly on the left/right edges
    return { projection: "mercator", center: [0, TROPIC_OF_CANCER], zoom: Math.max(0, Math.log2(w / 512)) };
  }
  const top = [...ctx.airports.values()]
    .filter((a) => a.lng != null && a.lat != null)
    .sort((a, b) => b.visits - a.visits)[0];
  return { projection: "globe", center: top ? [top.lng!, top.lat!] : [10, 25], zoom: 1.5 };
}
