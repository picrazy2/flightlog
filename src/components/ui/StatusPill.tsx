import { Icon, type IconName } from "./Icon";
import { color } from "@/lib/palette";

// Flight status as an icon + colour rather than a bare lowercase word, so a cancelled or
// still-upcoming flight is picked out by shape and colour while scanning a long list.
//
// Flown is deliberately the quiet one. It is almost every row, so colouring it green made
// it compete with upcoming's teal — two saturated greens a hue apart, on the two states
// that most need telling apart. The majority state reads as neutral and the exceptions
// carry the colour. Upcoming keeps color.upcoming, the same token the charts use.
const STATUS: Record<string, { label: string; icon: IconName; fg: string; bg: string }> = {
  completed: { label: "Flown", icon: "plane", fg: color.inkMuted, bg: "rgba(255,255,255,0.06)" },
  scheduled: { label: "Upcoming", icon: "wall-clock", fg: color.upcoming, bg: "rgba(45,212,191,0.14)" },
  cancelled: { label: "Cancelled", icon: "filter", fg: "#FB7185", bg: "rgba(251,113,133,0.12)" },
  diverted: { label: "Diverted", icon: "route", fg: color.secondary, bg: "rgba(255,192,97,0.12)" },
};

export function StatusPill({ status, compact }: { status: string | null; compact?: boolean }) {
  const s = STATUS[status ?? ""] ?? {
    label: status ?? "—",
    icon: "plane" as IconName,
    fg: "#98A2B3",
    bg: "rgba(255,255,255,0.06)",
  };
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-medium"
      style={{ color: s.fg, backgroundColor: s.bg }}
      title={status ?? undefined}
    >
      <Icon name={s.icon} size={11} color={s.fg} />
      {!compact && s.label}
    </span>
  );
}
