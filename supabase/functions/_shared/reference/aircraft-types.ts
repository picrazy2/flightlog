import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { load, type CheerioAPI } from "npm:cheerio@1.0.0";

const DOC8643_BASE_URL = "https://doc8643.com";
const AIRCRAFT_INDEX_URL = `${DOC8643_BASE_URL}/aircrafts`;
const UPSERT_BATCH_SIZE = 200;

export type AircraftTypeRefreshStats = {
  source: "doc8643";
  aircraft_types_upserted: number;
  aircraft_types_skipped: number;
  aircraft_type_code?: string;
  page_from?: number;
  page_to?: number;
  errors?: string[];
};

type AircraftTypeRecord = {
  code: string;
  name: string;
  manufacturer: string | null;
  family: string | null;
  body_class: "narrowbody" | "widebody" | null;
  deck_count: 1 | 2 | null;
  image_url: string | null;
};

export async function refreshAircraftTypes(
  supabase: SupabaseClient,
  options?: { pageFrom?: number; pageTo?: number },
): Promise<AircraftTypeRefreshStats> {
  const codes = await fetchAllAircraftTypeCodes(options);
  const { records, skipped, errors } = await fetchAircraftTypeRecords(codes);

  await upsertAircraftTypes(supabase, records);

  return {
    source: "doc8643",
    aircraft_types_upserted: records.length,
    aircraft_types_skipped: skipped,
    page_from: options?.pageFrom,
    page_to: options?.pageTo,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function refreshAircraftTypeByCode(
  supabase: SupabaseClient,
  code: string,
): Promise<AircraftTypeRefreshStats> {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) {
    throw new Error(`Invalid aircraft type code: ${code}`);
  }

  const record = await fetchAircraftTypeRecord(normalizedCode);
  if (!record) {
    return {
      source: "doc8643",
      aircraft_types_upserted: 0,
      aircraft_types_skipped: 1,
      aircraft_type_code: normalizedCode,
    };
  }

  await upsertAircraftTypes(supabase, [record]);

  return {
    source: "doc8643",
    aircraft_types_upserted: 1,
    aircraft_types_skipped: 0,
    aircraft_type_code: normalizedCode,
  };
}

async function fetchAllAircraftTypeCodes(
  options?: { pageFrom?: number; pageTo?: number },
): Promise<string[]> {
  const firstPageHtml = await fetchHtml(AIRCRAFT_INDEX_URL);
  const totalPages = extractTotalPages(firstPageHtml);
  const pageFrom = Math.max(1, options?.pageFrom ?? 1);
  const pageTo = Math.min(totalPages, options?.pageTo ?? totalPages);
  const codes = new Set<string>();

  for (let page = pageFrom; page <= pageTo; page += 1) {
    const html = page === 1 ? firstPageHtml : await fetchHtml(`${AIRCRAFT_INDEX_URL}/${page}`);
    for (const code of extractAircraftCodes(html)) {
      codes.add(code);
    }
  }

  return Array.from(codes);
}

export async function fetchAircraftTypePageCount(): Promise<number> {
  const firstPageHtml = await fetchHtml(AIRCRAFT_INDEX_URL);
  return extractTotalPages(firstPageHtml);
}

async function fetchAircraftTypeRecords(
  codes: string[],
): Promise<{
  records: AircraftTypeRecord[];
  skipped: number;
  errors: string[];
}> {
  const records: AircraftTypeRecord[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let index = 0; index < codes.length; index += UPSERT_BATCH_SIZE) {
    const batch = codes.slice(index, index + UPSERT_BATCH_SIZE);
    const batchRecords = await Promise.allSettled(
      batch.map(async (code) => {
        const record = await fetchAircraftTypeRecord(code);
        if (!record) {
          skipped += 1;
        }
        return record;
      }),
    );

    for (let batchIndex = 0; batchIndex < batchRecords.length; batchIndex += 1) {
      const result = batchRecords[batchIndex];
      const code = batch[batchIndex];

      if (result.status === "fulfilled") {
        if (result.value) {
          records.push(result.value);
        }
        continue;
      }

      skipped += 1;
      if (errors.length < 25) {
        errors.push(`${code}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    }
  }

  return { records, skipped, errors };
}

async function fetchAircraftTypeRecord(
  code: string,
): Promise<AircraftTypeRecord | null> {
  const html = await fetchHtml(`${DOC8643_BASE_URL}/aircraft/${code}`);
  const $ = parseHtml(html);

  const heading = $("h1").first().text().trim();
  if (!heading || heading !== code) {
    return null;
  }

  const manufacturerItems = $(".manuf-card .list-group-item")
    .toArray()
    .map((node) => $(node).text().trim())
    .filter(Boolean);

  const primaryName = manufacturerItems[0] ?? extractPrimaryName($);
  if (!primaryName) {
    return null;
  }

  const normalizedName = toTitleCase(primaryName);
  const manufacturer = extractManufacturer(normalizedName);
  const wingspanMeters = extractTechnicalNumber($, "Wing Span (m)");

  return {
    code,
    name: normalizedName,
    manufacturer,
    family: deriveFamily(code, normalizedName),
    body_class: deriveBodyClass(code, wingspanMeters),
    deck_count: deriveDeckCount(code),
    image_url: extractImageUrl($),
  };
}

async function upsertAircraftTypes(
  supabase: SupabaseClient,
  rows: AircraftTypeRecord[],
) {
  for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(index, index + UPSERT_BATCH_SIZE);
    const { error } = await supabase
      .from("aircraft_types")
      .upsert(batch, { onConflict: "code" });

    if (error) {
      throw new Error(`Failed to upsert aircraft_types: ${error.message}`);
    }
  }
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "flightlog-reference-refresh/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return await response.text();
}

function parseHtml(html: string): CheerioAPI {
  return load(html);
}

function extractTotalPages(html: string): number {
  const matches = Array.from(html.matchAll(/\/aircrafts\/(\d+)/g));
  const pageNumbers = matches.map((match) => Number(match[1])).filter(Number.isFinite);
  return Math.max(1, ...pageNumbers);
}

function extractAircraftCodes(html: string): string[] {
  const matches = Array.from(html.matchAll(/href="https?:\/\/doc8643\.com\/aircraft\/([^"\/?#]+)|href="\/aircraft\/([^"\/?#]+)/g));
  const codes = matches
    .map((match) => normalizeCode(match[1] ?? match[2] ?? ""))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(codes));
}

function extractPrimaryName($: CheerioAPI): string | null {
  const headerSummary = $(".detail-header p").first().text().replace(/\s+/g, " ").trim();
  if (headerSummary) {
    const pieces = headerSummary
      .split(/\s{2,}/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (pieces.length > 0) {
      return pieces[0];
    }
  }

  const title = $("title").first().text().trim();
  const titleMatch = title.match(/^(.+?)\s+[A-Z0-9]{2,4}\s+—\s+ICAO Type Designator/);
  return titleMatch?.[1]?.trim() || null;
}

function extractManufacturer(name: string): string | null {
  const firstToken = name.split(/\s+/)[0]?.trim();
  return firstToken || null;
}

function deriveFamily(code: string, name: string): string | null {
  const normalizedName = name.replace(/\s+/g, " ").trim();
  const airbusMatch = normalizedName.match(/^AIRBUS\s+A-?(\d{3})(neo)?/i);
  if (airbusMatch) {
    return airbusMatch[2] ? `A${airbusMatch[1]}neo family` : `A${airbusMatch[1]}`;
  }

  const boeingMatch = normalizedName.match(/^BOEING\s+(\d{3})/i);
  if (boeingMatch) {
    return boeingMatch[1];
  }

  const embraerMatch = normalizedName.match(/^EMBRAER\s+(\d{3})/i);
  if (embraerMatch) {
    return embraerMatch[1];
  }

  const atrMatch = normalizedName.match(/^ATR\s+(\d{2})/i);
  if (atrMatch) {
    return `ATR ${atrMatch[1]}`;
  }

  const codeMatch = code.match(/^([A-Z]\d{2,3})/);
  return codeMatch ? codeMatch[1] : null;
}

function extractImageUrl($: CheerioAPI): string | null {
  const src = $('img[alt*="aircraft photograph"]').first().attr("src")?.trim();
  if (!src) {
    return null;
  }

  return src.startsWith("http") ? src : `${DOC8643_BASE_URL}${src}`;
}

function extractTechnicalNumber(
  $: CheerioAPI,
  label: string,
): number | null {
  const row = $(".tech-row").toArray().find((node) => {
    return $(node).find(".tech-label").text().trim() === label;
  });

  if (!row) {
    return null;
  }

  const raw = $(row).find(".tech-value").text().trim();
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function deriveBodyClass(
  code: string,
  wingspanMeters: number | null,
): "narrowbody" | "widebody" | null {
  if (/^(A38|B74)/.test(code)) {
    return "widebody";
  }

  if (wingspanMeters === null) {
    return null;
  }

  return wingspanMeters >= 52 ? "widebody" : "narrowbody";
}

function deriveDeckCount(code: string): 1 | 2 {
  return /^(A38|B74)/.test(code) ? 2 : 1;
}

function toTitleCase(value: string): string {
  const titled = value
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());

  return titled
    .replace(/Neo\b/g, "neo")
    .replace(/(\d)er\b/g, "$1ER")
    .replace(/(\d)lr\b/g, "$1LR")
    .replace(/(\d)xlr\b/g, "$1XLR")
    .replace(/Er\b/g, "ER")
    .replace(/Lr\b/g, "LR")
    .replace(/Xlr\b/g, "XLR")
    .replace(/Xwb\b/g, "XWB")
    .replace(/Bbj\b/g, "BBJ")
    .replace(/F\b/g, "F");
}

function normalizeCode(code: string): string | null {
  const cleaned = code.trim().toUpperCase();
  return /^[A-Z0-9]{2,4}$/.test(cleaned) ? cleaned : null;
}
