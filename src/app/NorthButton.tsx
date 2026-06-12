import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useStore } from "@/state/store";

// "Reset north / 2D" — sits under the fullscreen button. Appears once the map has been
// rotated off north or tilted into 3D (cmd/shift-drag or two-finger drag). Tapping eases
// back to north + flat (pitch 0); the projection (globe vs flat) is left as-is. The
// compass turns with the heading.
export function NorthButton({ mobile }: { mobile?: boolean }) {
  const bearing = useStore((s) => s.mapBearing);
  const pitch = useStore((s) => s.mapPitch);
  const oriented = Math.abs(bearing) > 0.5 || pitch > 0.5;
  if (!oriented) return null;

  const reset = () => window.dispatchEvent(new CustomEvent("journia:resetnorth"));
  const icon = (
    <span className="inline-flex" style={{ transform: `rotate(${-bearing}deg)`, transition: "transform .2s ease" }}>
      <Icon name="compass" size={18} />
    </span>
  );
  const label = "Reset to 2D and north";

  if (mobile) {
    return (
      <button
        onClick={reset}
        aria-label={label}
        title="Flat map, facing north"
        className="focus-ring pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface-1 text-ink"
      >
        {icon}
      </button>
    );
  }
  return (
    <Button variant="secondary" size="md" iconOnly aria-label={label} title="Flat map, facing north" onClick={reset}>
      {icon}
    </Button>
  );
}
