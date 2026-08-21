import { useState } from "react";
import { SUPABASE_URL } from "@/lib/supabase";

// Airline mark, served from our own bucket — the reference refresh fetches each one once
// and records how it must be drawn, so nothing is hotlinked at render time.
//
// `treatment` comes from airlines.logo_treatment, decided by measuring the mark against
// the app surface when it was stored:
//   "color"   — light enough to read as-is, so full brand colour
//   "lighten" — too dark against #11141c (Lufthansa lands at 1.08:1), drawn as a white
//               silhouette. Inverting reaches similar contrast but returns the wrong
//               brand — BA comes out mint green — which reads worse than losing colour.
// Anything else (no mark, or an airline not yet synced) falls back to the IATA code.
const LOGO_BASE = `${SUPABASE_URL}/storage/v1/object/public/airline-logos`;

export function AirlineLogo({
  iata,
  name,
  treatment,
  size = 28,
}: {
  iata: string | null;
  name?: string | null;
  treatment?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const w = Math.round(size * 2.4);

  if (!iata || failed || treatment === "none" || treatment == null) {
    return (
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-md bg-surface-2 font-mono text-caption text-ink-muted"
        style={{ width: w, height: size }}
      >
        {iata ?? "—"}
      </span>
    );
  }

  return (
    <img
      src={`${LOGO_BASE}/${iata}.png`}
      alt={name ?? iata}
      width={w}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="shrink-0 object-contain"
      style={{
        width: w,
        height: size,
        filter: treatment === "lighten" ? "brightness(0) invert(0.92)" : undefined,
      }}
    />
  );
}
