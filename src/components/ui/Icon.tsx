// Renders a monochrome PNG from /public/icons as a recolorable mask, so a single
// icon set adopts any theme color (defaults to the current text color).
const BASE = import.meta.env.BASE_URL;

export type IconName =
  | "add"
  | "airplane"
  | "calendar"
  | "compass"
  | "distance"
  | "dollar-symbol"
  | "filter"
  | "globe"
  | "growth"
  | "magnifying-glass"
  | "mail"
  | "plane"
  | "right-chevron"
  | "route"
  | "setting"
  | "wall-clock";

interface Props {
  name: IconName;
  size?: number;
  color?: string; // any CSS color; defaults to inherited text color
  className?: string;
}

// Directional chevron built from the right-chevron asset (rotated). Use everywhere
// instead of unicode arrows so chevrons are consistent.
const CHEV_ROT = { right: 0, down: 90, left: 180, up: 270 } as const;
export function Chevron({ dir = "down", size = 12, color, className }: { dir?: keyof typeof CHEV_ROT; size?: number; color?: string; className?: string }) {
  return (
    <span className={className} style={{ display: "inline-flex", transform: `rotate(${CHEV_ROT[dir]}deg)`, transition: "transform .2s ease" }}>
      <Icon name="right-chevron" size={size} color={color} />
    </span>
  );
}

export function Icon({ name, size = 16, color = "currentColor", className }: Props) {
  const url = `url("${BASE}icons/${name}.png")`;
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        backgroundColor: color,
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}
