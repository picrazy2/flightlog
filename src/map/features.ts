import type { Feature, FeatureCollection } from "geojson";
import type { StatContext, MapEncoding, LegendModel } from "@/stats/types";
import type { AirportAgg } from "@/lib/aggregate";
import { greatCircleArc, flightCoords, trackSegments, routeKeyUndirected } from "@/lib/geo";
import { color } from "@/lib/palette";

const ROUTE_DEFAULT = (tripType: string | null) =>
  tripType === "domestic" ? color.accent : color.secondary;
// Colour for a route whose overlapping flights disagree. It is a real category with its
// own legend row, not a dimmed-out state: the line genuinely is not any one of them.
export const MIXED_COLOR = "#5C6575";
export const MIXED_LEGEND_ID = "mixed";
// Circle AREA ∝ visits → radius ∝ √visits. 1 visit = a small 3px dot.
const AIRPORT_SIZE = (visits: number) => Math.max(3, Math.min(26, 3 * Math.sqrt(visits)));

interface RenderOpts {
  showTracks?: boolean;
  tracks?: Map<string, [number, number][]>;
  dimTrackless?: boolean; // grey flights without a track (colour mode isn't dom/intl)
  // Treat colour-ambiguous overlapping routes as their own "Mixed" category (own colour
  // + own legend row) rather than letting whichever flight draws last decide. Used when
  // tracks are off, where every flight on a route collapses onto one line.
  mixedCategory?: boolean;
}

// Build line + airport GeoJSON with color/size baked into properties. Lines are
// rendered PER FLIGHT: its stored track when available (and Show tracks is on),
// otherwise a great-circle. Colour/legend come from the active module's per-flight
// encoders. No MapLibre expressions needed.
export function buildFeatures(
  ctx: StatContext,
  enc: MapEncoding | undefined,
  opts: RenderOpts = {},
): { routes: FeatureCollection; airports: FeatureCollection } {
  const off = ctx.legendFilter;
  const { showTracks = false, tracks, dimTrackless = false, mixedCategory = false } = opts;
  // flights per undirected route → great-circle thickness reflects how often flown
  // a flight renders as an actual track only when tracks are on and one is stored
  const hasTrackOf = (f: StatContext["flights"][number]) =>
    !!(showTracks && tracks && (tracks.get(f.id)?.length ?? 0) > 1);
  // count of great-circle (trackless) flights per undirected route — these overlap into
  // one line, so they drive its width and whether it's ambiguous to colour
  const tracklessByRoute = new Map<string, number>();
  // distinct attribute-colours among a route's trackless flights — if they all share
  // one colour the overlapping line can still be coloured (not greyed)
  const tracklessColors = new Map<string, Set<string>>();
  for (const f of ctx.flights) {
    if (hasTrackOf(f)) continue;
    const k = routeKeyUndirected(f.dep_iata, f.arr_iata);
    tracklessByRoute.set(k, (tracklessByRoute.get(k) ?? 0) + 1);
    const c = enc?.colorFlight?.(f, ctx) ?? ROUTE_DEFAULT(f.trip_type);
    const set = tracklessColors.get(k) ?? new Set<string>();
    set.add(c);
    tracklessColors.set(k, set);
  }

  const today = new Date().toISOString().slice(0, 10);

  const lineFeatures: Feature[] = [];
  for (const f of ctx.flights) {
    const rk = routeKeyUndirected(f.dep_iata, f.arr_iata);
    const ends = flightCoords(f);
    const trackCoords = showTracks && tracks ? tracks.get(f.id) : undefined;
    const drawsAsTrack = !!(trackCoords && trackCoords.length > 1);
    const tlCount = tracklessByRoute.get(rk) ?? 1;
    // A route's trackless flights collapse onto ONE great-circle, so when they disagree
    // on colour the line cannot honestly be any of them.
    const uniform = (tracklessColors.get(rk)?.size ?? 1) <= 1;
    const ambiguous = !drawsAsTrack && tlCount > 1 && !uniform;
    const asMixed = mixedCategory && ambiguous;

    // A mixed route filters as "Mixed", not as any of the categories feeding it —
    // otherwise hiding one airline would hide a line that isn't showing that airline.
    const legendId = asMixed ? MIXED_LEGEND_ID : enc?.flightLegendId?.(f, ctx);
    if (legendId && off[legendId]) continue;

    const baseColor = enc?.colorFlight?.(f, ctx) ?? ROUTE_DEFAULT(f.trip_type);
    const base = { fid: f.id, rk, dep: f.dep_iata, arr: f.arr_iata, date: f.flight_date, future: f.flight_date > today };

    if (trackCoords && trackCoords.length > 1) {
      // actual track: real segments + estimated (gap/airport-stitch) segments, drawn
      // separately so the estimated portions can be dashed/thinned independently
      for (const seg of trackSegments(trackCoords, ends?.from, ends?.to)) {
        lineFeatures.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: seg.coords },
          properties: { ...base, color: baseColor, width: 2, hasTrack: true, estimated: seg.estimated },
        });
      }
    } else if (ends) {
      // trackless great-circle (entirely estimated). Ambiguous routes render in the mixed
      // colour: as their own category when mixedCategory is on, or as the older dimmed
      // state when tracks are on. A route whose flights share one colour keeps it.
      const grey = asMixed || (dimTrackless && ambiguous);
      const arc = greatCircleArc(ends.from, ends.to) as Feature;
      arc.properties = {
        ...base,
        color: grey ? MIXED_COLOR : baseColor,
        width: 1 + Math.min(7, Math.log2(tlCount + 1) * 1.4),
        hasTrack: false,
        estimated: true,
        rc: tlCount, // route flight count — drives the aggregate popup (numeric so it survives query)
      };
      lineFeatures.push(arc);
    } else {
      continue;
    }
  }

  const airportFeatures: Feature[] = [];
  for (const a of ctx.airports.values() as IterableIterator<AirportAgg>) {
    if (a.lng == null || a.lat == null) continue;
    const legendId = enc?.airportLegendId?.(a, ctx);
    if (legendId && off[legendId]) continue;
    airportFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.lng, a.lat] },
      properties: {
        color: enc?.colorAirport?.(a, ctx) ?? color.airport,
        r: enc?.sizeAirport?.(a, ctx) ?? AIRPORT_SIZE(a.visits),
        iata: a.iata,
        name: a.name ?? "",
        city: a.city ?? "",
        visits: a.visits,
      },
    });
  }

  return {
    routes: { type: "FeatureCollection", features: lineFeatures },
    airports: { type: "FeatureCollection", features: airportFeatures },
  };
}


// True when some route's flights would collapse onto one line under disagreeing colours.
// Assumes the trackless (tracks-off) view, where every flight collapses. Early-exits.
export function hasMixedRoutes(ctx: StatContext, enc: MapEncoding | undefined): boolean {
  const colorOf = new Map<string, string>();
  for (const f of ctx.flights) {
    const rk = routeKeyUndirected(f.dep_iata, f.arr_iata);
    const c = enc?.colorFlight?.(f, ctx) ?? ROUTE_DEFAULT(f.trip_type);
    const prev = colorOf.get(rk);
    if (prev === undefined) colorOf.set(rk, c);
    else if (prev !== c) return true;
  }
  return false;
}

// The encoding's legend, plus a "Mixed" row when ambiguous routes are actually on screen.
// Appended here rather than inside each encoding because mixedness is a property of how
// routes collapse on the map, not of the attribute being coloured.
export function legendFor(
  enc: MapEncoding | undefined,
  ctx: StatContext,
  mixedCategory: boolean,
): LegendModel | undefined {
  const model = enc?.legend?.(ctx);
  if (!model || !mixedCategory || !hasMixedRoutes(ctx, enc)) return model;
  return {
    ...model,
    items: [
      ...model.items,
      { id: MIXED_LEGEND_ID, label: "Mixed", color: MIXED_COLOR, swatch: "line" as const },
    ],
  };
}
