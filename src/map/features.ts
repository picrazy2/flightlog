import type { Feature, FeatureCollection } from "geojson";
import type { StatContext, MapEncoding } from "@/stats/types";
import type { AirportAgg } from "@/lib/aggregate";
import { greatCircleArc, flightCoords, trackSegments, routeKeyUndirected } from "@/lib/geo";
import { color } from "@/lib/palette";

const ROUTE_DEFAULT = (tripType: string | null) =>
  tripType === "domestic" ? color.accent : color.secondary;
const TRACKLESS_GREY = "#5C6575";
// Circle AREA ∝ visits → radius ∝ √visits. 1 visit = a small 3px dot.
const AIRPORT_SIZE = (visits: number) => Math.max(3, Math.min(26, 3 * Math.sqrt(visits)));

interface RenderOpts {
  showTracks?: boolean;
  tracks?: Map<string, [number, number][]>;
  dimTrackless?: boolean; // grey flights without a track (colour mode isn't dom/intl)
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
  const { showTracks = false, tracks, dimTrackless = false } = opts;
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
    const legendId = enc?.flightLegendId?.(f, ctx);
    if (legendId && off[legendId]) continue;

    const ends = flightCoords(f);
    const trackCoords = showTracks && tracks ? tracks.get(f.id) : undefined;
    const tlCount = tracklessByRoute.get(routeKeyUndirected(f.dep_iata, f.arr_iata)) ?? 1;
    const baseColor = enc?.colorFlight?.(f, ctx) ?? ROUTE_DEFAULT(f.trip_type);
    const rk = routeKeyUndirected(f.dep_iata, f.arr_iata);
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
      // trackless great-circle (entirely estimated). Grey only when 2+ trackless flights
      // overlap this route AND they don't share a single attribute-colour; if they're all
      // the same colour (e.g. one year class) keep it coloured. A lone one is always coloured.
      const uniform = (tracklessColors.get(rk)?.size ?? 1) <= 1;
      const grey = dimTrackless && tlCount > 1 && !uniform;
      const arc = greatCircleArc(ends.from, ends.to) as Feature;
      arc.properties = {
        ...base,
        color: grey ? TRACKLESS_GREY : baseColor,
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
