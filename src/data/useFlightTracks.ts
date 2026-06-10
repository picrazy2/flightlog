import { useQuery } from "@tanstack/react-query";
import { restGet } from "@/lib/supabase";

interface TrackRow {
  flight_id: string;
  geojson: { type: string; coordinates: [number, number][] } | null;
}

// All stored flight tracks → flight_id ⇒ coordinate list. Fetched once, lazily joined
// to flights on the map when "Show tracks" is on.
export function useFlightTracks() {
  return useQuery({
    queryKey: ["flight-tracks"],
    queryFn: async () => {
      const rows = await restGet<TrackRow[]>("v_flight_tracks?select=flight_id,geojson&limit=5000");
      const m = new Map<string, [number, number][]>();
      for (const r of rows) {
        const c = r.geojson?.coordinates;
        if (c && c.length > 1) m.set(r.flight_id, c);
      }
      return m;
    },
    staleTime: 5 * 60 * 1000,
  });
}
