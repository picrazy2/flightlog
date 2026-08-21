import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Wikidata, not the OpenFlights dump: OpenFlights stopped being maintained around 2014,
// so carriers that launched or rebranded since have no row under their code at all —
// Spring, Beijing Capital, VietJet, ZIPAIR, LATAM were all missing or named as the dead
// carrier that used to hold the code. Wikidata is current and already the source for the
// alliance step next door.
const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const UPSERT_BATCH_SIZE = 1_000;

// Paged deliberately. The unpaged query exceeds the endpoint's response cap and comes
// back as truncated JSON under a 200, which parses as a silent half-dataset.
const WIKIDATA_PAGE_SIZE = 500;
const WIKIDATA_MAX_PAGES = 20;

const AIRLINES_QUERY = (limit: number, offset: number) => `
SELECT ?iata ?icao ?airlineLabel ?countryLabel ?dissolved ?links WHERE {
  ?airline wdt:P31/wdt:P279* wd:Q46970 ;
           wdt:P229 ?iata ;
           wikibase:sitelinks ?links .
  OPTIONAL { ?airline wdt:P230 ?icao }
  OPTIONAL { ?airline wdt:P17 ?country }
  OPTIONAL { ?airline wdt:P576 ?dissolved }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?iata ?airlineLabel
LIMIT ${limit} OFFSET ${offset}`;

// IATA codes OpenFlights has wrong — the code was reassigned to a newer carrier, or
// the dataset never updated. These corrected name/ICAO values are applied after the
// OpenFlights merge so a reference refresh can't revert them (a wrong ICAO silently
// breaks AeroAPI enrichment — see W9 → WUK). Add a row here whenever you fix one by hand.
// Escape hatch for codes Wikidata's ranking can't resolve on its own: entities with no
// English label (which would otherwise surface as a bare QID), airlines too new or too
// thinly documented to out-rank a defunct predecessor, and codes whose current holder is
// wrong for *these* flights because the leg predates the reassignment (MI, WW, XW).
const AIRLINE_OVERRIDES: Record<string, { name: string; icao: string }> = {
  A6: { name: "Air Travel Co. Ltd", icao: "OTC" }, // Wikidata label is the bare "Air Travel"
  CN: { name: "Grand China Air", icao: "GDC" }, // Wikidata confirms GDC; code also held by Westward
  W4: { name: "Wizz Air Malta", icao: "WMT" }, // too new / thin on Wikidata
  W9: { name: "Wizz Air UK", icao: "WUK" }, // too new / thin on Wikidata
  XW: { name: "NokScoot", icao: "NCT" }, // dissolved 2020; code since reused
  "9C": { name: "Spring Airlines", icao: "CQH" }, // pinned; Wikidata agrees, kept as a guard
  HO: { name: "Juneyao Airlines", icao: "DKH" }, // Wikidata entity has no English label (Q1713277)
  MI: { name: "SilkAir", icao: "SLK" }, // code now Freebird Europe; flights predate the 2021 SQ merger
  JD: { name: "Beijing Capital Airlines", icao: "CBJ" }, // code also held by Japan Air System (defunct 2006)
  LA: { name: "LATAM Airlines", icao: "LAN" }, // LAN renamed 2016
  VJ: { name: "VietJet Air", icao: "VJC" }, // code also held by Jatayu / Royal Air Cambodge
  VY: { name: "Vueling Airlines", icao: "VLG" }, // Wikidata labels it plain "Vueling"
  WW: { name: "WOW air", icao: "WOW" }, // dissolved 2019; flights predate it, code since reused
  ZG: { name: "ZIPAIR Tokyo", icao: "TZP" }, // outranked by better-documented Grozny Avia
};

type AirlineRecord = {
  name?: string;
  iata?: string;
  icao?: string;
  country?: string;
  dissolved?: string; // P576; absent means still trading
  links?: number; // sitelink count, used as a notability tiebreak
};

export type AirlineRefreshStats = {
  source: "wikidata";
  airlines_upserted: number;
  airlines_skipped_missing_iata: number;
  airline_iata?: string;
};

export async function refreshAirlines(
  supabase: SupabaseClient,
  options?: { airlineIata?: string },
): Promise<AirlineRefreshStats> {
  const rows = await fetchAirlineRows();
  const targetAirline = options?.airlineIata?.trim().toUpperCase();
  const airlinesByIata = new Map<string, Record<string, unknown>>();
  let skippedMissingIata = 0;

  for (const row of rows) {
    const iata = cleanCode(row.iata, 2);
    if (!iata) {
      skippedMissingIata += 1;
      continue;
    }

    if (targetAirline && iata !== targetAirline) {
      continue;
    }

    const name = cleanString(row.name);
    if (!name) {
      continue;
    }

    const candidate = {
      iata,
      icao: cleanCode(row.icao, 3),
      name,
      country: cleanString(row.country),
      dissolved: cleanString(row.dissolved),
      links: row.links ?? 0,
    };

    const existing = airlinesByIata.get(iata);
    if (!existing || isBetterAirlineRecord(candidate, existing)) {
      airlinesByIata.set(iata, candidate);
    }
  }

  // Apply hand-corrected overrides last so they win over (and survive) OpenFlights.
  for (const [iata, override] of Object.entries(AIRLINE_OVERRIDES)) {
    if (targetAirline && iata !== targetAirline) continue;
    const existing = airlinesByIata.get(iata) as { country?: unknown } | undefined;
    airlinesByIata.set(iata, {
      iata,
      icao: override.icao,
      name: override.name,
      country: existing?.country ?? null,
    });
  }

  // dissolved/links exist only to rank candidates; public.airlines has neither column.
  const airlines = Array.from(airlinesByIata.values())
    .map(({ dissolved: _d, links: _l, ...row }) => row);

  await upsertInBatches(supabase, "airlines", airlines, "iata");

  return {
    source: "wikidata",
    airlines_upserted: airlines.length,
    airlines_skipped_missing_iata: skippedMissingIata,
    airline_iata: targetAirline,
  };
}

async function fetchAirlineRows(): Promise<AirlineRecord[]> {
  const rows: AirlineRecord[] = [];

  for (let page = 0; page < WIKIDATA_MAX_PAGES; page++) {
    const query = AIRLINES_QUERY(WIKIDATA_PAGE_SIZE, page * WIKIDATA_PAGE_SIZE);
    const bindings = await fetchSparqlPage(query, page);
    for (const b of bindings) {
      const name = b.airlineLabel?.value?.trim();
      // An entity with no English label comes back as its bare QID ("Q1713277"), which
      // must never reach the UI as an airline name. Dropping it hands the code to the
      // next candidate — usually a defunct one — so anything that matters is pinned in
      // AIRLINE_OVERRIDES.
      if (!name || /^Q\d+$/.test(name)) continue;
      rows.push({
        name,
        iata: b.iata?.value,
        icao: b.icao?.value,
        country: b.countryLabel?.value,
        dissolved: b.dissolved?.value,
        links: Number(b.links?.value ?? 0),
      });
    }
    if (bindings.length < WIKIDATA_PAGE_SIZE) return rows;
  }

  throw new Error(
    `Wikidata airlines paging exceeded ${WIKIDATA_MAX_PAGES} pages — the result set grew unexpectedly`,
  );
}

type AirlineBinding = {
  iata?: { value: string };
  icao?: { value: string };
  airlineLabel?: { value: string };
  countryLabel?: { value: string };
  dissolved?: { value: string };
  links?: { value: string };
};

// The endpoint 502s and times out under load often enough that one attempt isn't
// reliable; a failed page would otherwise leave the refresh silently short.
async function fetchSparqlPage(query: string, page: number): Promise<AirlineBinding[]> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3_000 * attempt));
    try {
      const response = await fetch(
        `${WIKIDATA_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`,
        {
          headers: {
            "accept": "application/sparql-results+json",
            "user-agent": "flightlog-reference-refresh/1.0",
          },
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Truncated responses arrive as invalid JSON under a 200, so a parse failure here
      // is a real (and loud) outcome rather than something to swallow.
      const data = JSON.parse(await response.text()) as {
        results?: { bindings?: AirlineBinding[] };
      };
      return data.results?.bindings ?? [];
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Failed to fetch Wikidata airlines page ${page}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function upsertInBatches(
  supabase: SupabaseClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  onConflict: string,
) {
  for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(index, index + UPSERT_BATCH_SIZE);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict });

    if (error) {
      throw new Error(`Failed to upsert ${table}: ${error.message}`);
    }
  }
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "\\N") {
    return null;
  }

  return trimmed;
}

// IATA/ICAO codes are ASCII alphanumerics. Length alone isn't enough: Wikidata carries
// the odd native-script value in P229 — "АЯ" (Cyrillic) for Аэросервис — which passes a
// length check, then fails every logo fetch and storage write forever after.
function cleanCode(value: unknown, expectedLength: number): string | null {
  const cleaned = cleanString(value)?.toUpperCase();
  if (!cleaned || cleaned.length !== expectedLength || !/^[A-Z0-9]+$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function isBetterAirlineRecord(
  candidate: Record<string, unknown>,
  existing: Record<string, unknown>,
): boolean {
  return scoreAirlineRecord(candidate) > scoreAirlineRecord(existing);
}

// Ranks rows that share an IATA code — most do, because a code is reassigned when its
// holder folds and Wikidata keeps every past holder.
//
// Still trading beats dissolved. Beyond that the tiebreak is sitelink count, i.e. how
// many Wikipedias write about the airline: the carrier currently flying under a code is
// essentially always the better-documented one. Ranking on recency instead picks Eastern
// Australia Airlines over Qantas for QF, and "has an ICAO code" alone picks whichever
// happened to be listed first.
function scoreAirlineRecord(record: Record<string, unknown>): number {
  const alive = record.dissolved ? 0 : 1;
  const links = Math.min(Number(record.links ?? 0), 999);
  return alive * 1_000_000 + links * 10 + (record.icao ? 1 : 0);
}
