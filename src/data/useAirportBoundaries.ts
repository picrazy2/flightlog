import { useQuery } from "@tanstack/react-query";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { restGet } from "@/lib/supabase";

interface BoundaryRow {
  iata: string;
  boundary_geojson: Geometry;
}

// Fetch stored airport footprint polygons for the given airports (static geometry,
// fetched once). Returns a FeatureCollection ready for a MapLibre source.
export function useAirportBoundaries(iatas: string[]) {
  const key = [...iatas].sort().join(",");
  return useQuery({
    queryKey: ["airport-boundaries", key],
    enabled: iatas.length > 0,
    staleTime: Infinity,
    queryFn: async (): Promise<FeatureCollection> => {
      const out: Feature[] = [];
      // chunk to keep the URL length sane
      for (let i = 0; i < iatas.length; i += 120) {
        const chunk = iatas.slice(i, i + 120);
        const rows = await restGet<BoundaryRow[]>(
          `airports?select=iata,boundary_geojson&boundary_geojson=not.is.null&iata=in.(${chunk.join(",")})`,
        );
        for (const r of rows) {
          out.push({ type: "Feature", geometry: r.boundary_geojson, properties: { iata: r.iata } });
        }
      }
      return { type: "FeatureCollection", features: out };
    },
  });
}
