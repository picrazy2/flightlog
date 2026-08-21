import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decode as decodePng } from "npm:fast-png@6";

// Airline marks, fetched once and stored in our own bucket rather than hotlinked on every
// row render. The source CDN is keyless and returns transparent full-colour PNGs.
const LOGO_CDN = (iata: string, w: number, h: number) => `https://pics.avs.io/${w}/${h}/${iata}.png`;
const BUCKET = "airline-logos";

// 2x the ~67x28 the UI draws, so the mark stays sharp on a retina screen.
const LOGO_W = 144;
const LOGO_H = 48;

// The app surface. A mark is kept in full colour only if it clears a readable contrast
// ratio against this; anything darker is flagged for the client to whiten.
const SURFACE = [0x11, 0x14, 0x1c];
const MIN_CONTRAST = 3;

export type LogoTreatment = "color" | "lighten" | "none";

export type LogoSyncStats = {
  source: "pics.avs.io";
  logos_checked: number;
  logos_uploaded: number;
  logos_color: number;
  logos_lightened: number;
  logos_missing: number;
};

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (r: number, g: number, b: number) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/**
 * Mean contrast of a PNG's opaque pixels against the app surface, or null when the image
 * carries no opaque pixels at all (a blank the CDN serves for codes it doesn't have).
 */
export function contrastAgainstSurface(png: Uint8Array): number | null {
  const img = decodePng(png);
  const data = img.data as Uint8Array | Uint16Array;
  const ch = img.channels;
  // 16-bit PNGs would otherwise read as absurdly bright; normalise to 0-255.
  const scale = img.depth === 16 ? 1 / 257 : 1;

  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += ch) {
    const alpha = ch === 4 || ch === 2 ? Number(data[i + ch - 1]) * scale : 255;
    if (alpha < 200) continue;
    const r = Number(data[i]) * scale;
    const g = ch >= 3 ? Number(data[i + 1]) * scale : r;
    const b = ch >= 3 ? Number(data[i + 2]) * scale : r;
    sum += luminance(r, g, b);
    count++;
  }
  if (count === 0) return null;

  const mark = sum / count;
  const bg = luminance(SURFACE[0], SURFACE[1], SURFACE[2]);
  return (Math.max(mark, bg) + 0.05) / (Math.min(mark, bg) + 0.05);
}

/**
 * Fetch, measure and store the mark for every airline that doesn't have one yet.
 * Safe to re-run: airlines with a treatment already recorded are skipped unless `force`.
 */
export async function syncAirlineLogos(
  supabase: SupabaseClient,
  options?: { airlineIata?: string; force?: boolean; limit?: number },
): Promise<LogoSyncStats> {
  let query = supabase.from("airlines").select("iata, logo_treatment");
  if (options?.airlineIata) query = query.eq("iata", options.airlineIata.toUpperCase());
  else if (!options?.force) query = query.is("logo_treatment", null);

  const { data, error } = await query.limit(options?.limit ?? 5_000);
  if (error) throw new Error(`Failed to list airlines for logo sync: ${error.message}`);

  const stats: LogoSyncStats = {
    source: "pics.avs.io",
    logos_checked: 0,
    logos_uploaded: 0,
    logos_color: 0,
    logos_lightened: 0,
    logos_missing: 0,
  };

  for (const row of (data ?? []) as Array<{ iata: string }>) {
    stats.logos_checked++;
    let treatment: LogoTreatment = "none";

    try {
      const res = await fetch(LOGO_CDN(row.iata, LOGO_W, LOGO_H));
      // The CDN answers 200 for unknown codes too, so a usable mark is decided by whether
      // the image has any opaque pixels, never by the status line.
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        const contrast = contrastAgainstSurface(bytes);
        if (contrast !== null) {
          treatment = contrast >= MIN_CONTRAST ? "color" : "lighten";
          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(`${row.iata}.png`, bytes, {
              contentType: "image/png",
              upsert: true,
              cacheControl: "31536000",
            });
          if (upErr) throw new Error(upErr.message);
          stats.logos_uploaded++;
        }
      }
    } catch {
      // A CDN hiccup shouldn't poison the row — leaving logo_treatment null means the
      // next refresh retries it, whereas writing 'none' would make the miss permanent.
      continue;
    }

    if (treatment === "color") stats.logos_color++;
    else if (treatment === "lighten") stats.logos_lightened++;
    else stats.logos_missing++;

    await supabase
      .from("airlines")
      .update({ logo_treatment: treatment, logo_updated_at: new Date().toISOString() })
      .eq("iata", row.iata);
  }

  return stats;
}
