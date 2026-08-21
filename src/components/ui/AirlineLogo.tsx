import { useState } from "react";

// Airline mark, hotlinked from the Aviasales logo CDN (keyless, same hotlinking approach
// as the doc8643 aircraft photos). Logos are dark-on-transparent, so they're inverted to
// sit on the dark surfaces; anything the CDN doesn't have falls back to the IATA code so
// a row never collapses to an empty box.
export function AirlineLogo({
  iata,
  name,
  size = 28,
}: {
  iata: string | null;
  name?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const w = Math.round(size * 2.4);

  if (!iata || failed) {
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
      src={`https://pics.avs.io/${w * 2}/${size * 2}/${iata}.png`}
      alt={name ?? iata}
      width={w}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 object-contain"
      style={{ width: w, height: size, filter: "brightness(0) invert(0.92)" }}
    />
  );
}
