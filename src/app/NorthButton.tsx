import { Button } from "@/components/ui/Button";
import { useStore } from "@/state/store";
import { useIsMobile } from "@/lib/useIsMobile";

// Compass needle; rotates opposite the map bearing so it always points at true north.
function NorthNeedle({ bearing }: { bearing: number }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden style={{ transform: `rotate(${-bearing}deg)` }}>
      <path d="M8 1.5 L11 8 L8 6.4 L5 8 Z" fill="currentColor" />
      <path d="M8 6.4 L11 8 L8 14.5 L5 8 Z" fill="currentColor" fillOpacity="0.35" />
    </svg>
  );
}

// "Reset north / 2D" — sits under the fullscreen button on mobile/tablet and on the globe
// (where the map is freely rotatable), plus on any rotated/tilted map. Tapping eases back
// to north + flat. The needle reflects the live heading.
export function NorthButton({ mobile }: { mobile?: boolean }) {
  const bearing = useStore((s) => s.mapBearing);
  const pitch = useStore((s) => s.mapPitch);
  const projection = useStore((s) => s.projection);
  const compact = useIsMobile(1024); // phone or tablet
  const oriented = Math.abs(bearing) > 0.5 || pitch > 0.5;
  if (!(compact || projection === "globe" || oriented)) return null;

  const reset = () => window.dispatchEvent(new CustomEvent("journia:resetnorth"));
  const label = "Reset north and 2D";

  if (mobile) {
    return (
      <button
        onClick={reset}
        aria-label={label}
        title="Reset bearing & tilt"
        className="focus-ring pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface-1 text-ink"
      >
        <NorthNeedle bearing={bearing} />
      </button>
    );
  }
  return (
    <Button variant="secondary" size="md" iconOnly aria-label={label} title="Reset bearing & tilt" onClick={reset}>
      <NorthNeedle bearing={bearing} />
    </Button>
  );
}
