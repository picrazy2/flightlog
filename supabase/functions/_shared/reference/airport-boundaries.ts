import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import osmtogeojson from "npm:osmtogeojson@3.0.0-beta.5";

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];

type AirportRecord = {
  iata: string;
  icao: string | null;
  name: string;
  latitude: number;
  longitude: number;
};

type GeoJsonFeature = {
  type: "Feature";
  geometry: {
    type: "Polygon" | "MultiPolygon" | string;
    coordinates: unknown;
  } | null;
  properties?: Record<string, unknown>;
};

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

export type AirportBoundaryRefreshStats = {
  source: "overpass";
  airport_iata: string;
  boundary_found: boolean;
};

export async function refreshAirportBoundary(
  supabase: SupabaseClient,
  airportIata: string,
): Promise<AirportBoundaryRefreshStats> {
  const airport = await loadAirport(supabase, airportIata);
  if (!airport) {
    throw new Error(`Airport not found for IATA ${airportIata}`);
  }

  const overpass = await fetchBoundaryFromOverpass(airport);
  const feature = selectBoundaryFeature(overpass, airport);

  const { error } = await supabase
    .from("airports")
    .update({
      boundary_geojson: feature?.geometry ?? null,
    })
    .eq("iata", airport.iata);

  if (error) {
    throw new Error(`Failed to update airport boundary for ${airport.iata}: ${error.message}`);
  }

  return {
    source: "overpass",
    airport_iata: airport.iata,
    boundary_found: Boolean(feature?.geometry),
  };
}

async function loadAirport(
  supabase: SupabaseClient,
  airportIata: string,
): Promise<AirportRecord | null> {
  const normalizedIata = airportIata.trim().toUpperCase();
  const { data, error } = await supabase
    .from("airports")
    .select("iata, icao, name, latitude, longitude")
    .eq("iata", normalizedIata)
    .single();

  if (error) {
    throw new Error(`Failed to load airport ${normalizedIata}: ${error.message}`);
  }

  return data as AirportRecord | null;
}

async function fetchBoundaryFromOverpass(
  airport: AirportRecord,
): Promise<GeoJsonFeatureCollection> {
  const queries = buildOverpassQueries(airport);
  let lastError: Error | null = null;

  for (const query of queries) {
    for (const url of OVERPASS_URLS) {
      try {
        const collection = await executeOverpassQuery(url, query);
        if (collection.features.length > 0) {
          return collection;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  return { type: "FeatureCollection", features: [] };
}

function buildOverpassQueries(airport: AirportRecord): string[] {
  const radiusMeters = 5000;
  const escapedName = airport.name.replace(/"/g, '\\"');
  const queries: string[] = [];

  if (airport.icao) {
    queries.push(`
[out:json][timeout:60];
(
  relation(around:${radiusMeters},${airport.latitude},${airport.longitude})["aeroway"="aerodrome"]["icao"="${airport.icao}"];
  way(around:${radiusMeters},${airport.latitude},${airport.longitude})["aeroway"="aerodrome"]["icao"="${airport.icao}"];
);
out geom;
`);
  }

  queries.push(`
[out:json][timeout:60];
(
  relation(around:${radiusMeters},${airport.latitude},${airport.longitude})["aeroway"="aerodrome"]["iata"="${airport.iata}"];
  way(around:${radiusMeters},${airport.latitude},${airport.longitude})["aeroway"="aerodrome"]["iata"="${airport.iata}"];
);
out geom;
`);

  queries.push(`
[out:json][timeout:60];
(
  relation(around:${radiusMeters},${airport.latitude},${airport.longitude})["aeroway"="aerodrome"]["name"="${escapedName}"];
  way(around:${radiusMeters},${airport.latitude},${airport.longitude})["aeroway"="aerodrome"]["name"="${escapedName}"];
);
out geom;
`);

  return queries;
}

async function executeOverpassQuery(
  url: string,
  query: string,
): Promise<GeoJsonFeatureCollection> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "accept": "application/json",
      "user-agent": "flightlog-reference-refresh/1.0",
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Overpass data: ${response.status}`);
  }

  const json = await response.json();
  return osmtogeojson(json) as GeoJsonFeatureCollection;
}

function selectBoundaryFeature(
  collection: GeoJsonFeatureCollection,
  airport: AirportRecord,
): GeoJsonFeature | null {
  const candidates = collection.features.filter((feature) =>
    feature.geometry &&
    (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon")
  );

  if (candidates.length === 0) {
    return null;
  }

  const scored = candidates.map((feature) => ({
    feature,
    score: scoreFeature(feature, airport),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.feature ?? null;
}

function scoreFeature(feature: GeoJso