import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";

const ALLIANCE_QUERY = `
SELECT ?iata ?allianceCode WHERE {
  ?airline wdt:P31/wdt:P279* wd:Q46970;
           wdt:P229 ?iata;
           wdt:P114 ?alliance.
  VALUES (?alliance ?allianceCode) {
    (wd:Q189709 "star_alliance")
    (wd:Q212282 "skyteam")
    (wd:Q8787 "oneworld")
  }
}
`;

export type AllianceRefreshStats = {
  source: "wikidata";
  airline_alliances_updated: number;
  airline_iata?: string;
};

type SparqlBinding = {
  iata?: { value: string };
  allianceCode?: { value: "star_alliance" | "skyteam" | "oneworld" };
};

export async function refreshAirlineAlliances(
  supabase: SupabaseClient,
  options?: { airlineIata?: string },
): Promise<AllianceRefreshStats> {
  const response = await fetch(`${WIKIDATA_ENDPOINT}?format=json&query=${encodeURIComponent(ALLIANCE_QUERY)}`, {
    headers: {
      "accept": "application/sparql-results+json",
      "user-agent": "flightlog-reference-refresh/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Wikidata alliances: ${response.status}`);
  }

  const data = await response.json() as {
    results?: { bindings?: SparqlBinding[] };
  };

  const bindings = data.results?.bindings ?? [];
  const targetAirline = options?.airlineIata?.trim().toUpperCase();
  const updates = new Map<
    string,
    { iata: string; alliance: "star_alliance" | "skyteam" | "oneworld" }
  >();

  for (const binding of bindings) {
    const iata = binding.iata?.value?.trim().toUpperCase();
    const alliance = binding.allianceCode?.value;

    if (!iata || !alliance) {
      continue;
    }
    if (targetAirline && iata !== targetAirline) {
      continue;
    }
    updates.set(iata, { iata, alliance });
  }

  const batchSize = 500;
  const rows = Array.from(updates.values());
  for (let index = 0; index < rows.length; index += batchSize) {
    cons