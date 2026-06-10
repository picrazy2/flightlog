import type { Feature, LineString } from "geojson";
import type { Flight } from "./types";

const R = Math.PI / 180;
const D = 180 / Math.PI;

// Great-circle arc as a single LineString with longitudes "unwrapped" (consecutive
// points never jump >180°), so MapLibre draws one continuous line across the
// antimeridian instead of a split with a gap.
export function greatCircleArc(from: [number, number], to: [number, number]): Feature<LineString> {
  const [lon1, lat1] = from;
  const [lon2, lat2] = to;
  const φ1 = lat1 * R, λ1 = lon1 * R, φ2 = lat2 * R, λ2 = lon2 * R;
  const dφ = φ2 - φ1, dλ = λ2 - λ1;
  const hav = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(hav)));

  const coords: [number, number][] = [];
  const n = 128;
  if (d === 0) {
    coords.push([lon1, lat1], [lon2, lat2]);
  } else {
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const A = Math.sin((1 - f) * d) / Math.sin(d);
      const B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
      const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
      const z = A * Math.sin(φ1) + B * Math.sin(φ2);
      const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
      const λ = Math.atan2(y, x);
      coords.push([λ * D, φ * D]);
    }
  }
  // unwrap longitudes
  for (let i = 1; i < coords.length; i++) {
    let dl = coords[i][0] - coords[i - 1][0];
    while (dl > 180) {
      coords[i][0] -= 360;
      dl = coords[i][0] - coords[i - 1][0];
    }
    while (dl < -180) {
      coords[i][0] += 360;
      dl = coords[i][0] - coords[i - 1][0];
    }
  }
  return { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} };
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const φ1 = a[1] * R, φ2 = b[1] * R, dφ = (b[1] - a[1]) * R, dλ = (b[0] - a[0]) * R;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const TRACK_GAP_KM = 400;

function unwrapLngs(coords: [number, number][]): void {
  for (let i = 1; i < coords.length; i++) {
    let dl = coords[i][0] - coords[i - 1][0];
    while (dl > 180) {
      coords[i][0] -= 360;
      dl = coords[i][0] - coords[i - 1][0];
    }
    while (dl < -180) {
      coords[i][0] += 360;
      dl = coords[i][0] - coords[i - 1][0];
    }
  }
}

export interface TrackSegment {
  coords: [number, number][];
  estimated: boolean;
}

// Split a track into REAL segments (runs of actual ADS-B points) and ESTIMATED segments
// (great-circle bridges over coverage gaps + stitches to the dep/arr airports when the
// track starts/ends mid-flight). Adjacent segments share an endpoint so the line stays
// continuous; longitudes are unwrapped per segment for antimeridian continuity.
export function trackSegments(
  coords: [number, number][],
  from?: [number, number] | null,
  to?: [number, number] | null,
): TrackSegment[] {
  const pts: [number, number][] = [];
  if (from) pts.push([from[0], from[1]]);
  for (const c of coords) pts.push([c[0], c[1]]);
  if (to) pts.push([to[0], to[1]]);
  if (pts.length < 2) return [];

  const segs: TrackSegment[] = [{ coords: [pts[0]], estimated: false }];
  const add = (pt: [number, number], est: boolean) => {
    const cur = segs[segs.length - 1];
    if (cur.estimated !== est) {
      segs.push({ coords: [cur.coords[cur.coords.length - 1], pt], estimated: est });
    } else {
      cur.coords.push(pt);
    }
  };
  for (let i = 1; i < pts.length; i++) {
    if (haversineKm(pts[i - 1], pts[i]) > TRACK_GAP_KM) {
      const arc = greatCircleArc(pts[i - 1], pts[i]).geometry.coordinates as [number, number][];
      for (let j = 1; j < arc.length - 1; j++) add([arc[j][0], arc[j][1]], true);
      add(pts[i], true);
    } else {
      add(pts[i], false);
    }
  }
  for (const s of segs) unwrapLngs(s.coords);
  return segs.filter((s) => s.coords.length >= 2);
}

export function flightCoords(f: Flight): { from: [number, number]; to: [number, number] } | null {
  if (f.dep_lng == null || f.dep_lat == null || f.arr_lng == null || f.arr_lat == null) return null;
  return { from: [f.dep_lng, f.dep_lat], to: [f.arr_lng, f.arr_lat] };
}

export function routeKeyUndirected(a: string, b: string): string {
  return [a, b].sort().join("·");
}
export function routeKeyDirected(a: string, b: string): string {
  return `${a}→${b}`;
}
