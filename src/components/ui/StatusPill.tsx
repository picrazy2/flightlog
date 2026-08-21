import { Icon, type IconName } from "./Icon";

// Flight status as an icon + colour rather than a bare lowercase word, so a cancelled or
// still-upcoming flight is picked out by shape and colour while scanning a long list.
const STATUS: Record<string, { label: string; icon: IconName; fg: string; bg: string }> = {
  completed: { label: "Flown", icon: "plane", fg: "#34D399", bg: "rgba(52,211,153,0.12)" },
  scheduled: { label: "Upcoming", icon: "wall-clock", fg: "#2DD4BF", bg: "rgba(45,212,191,0.12)" },
  cancelled: { label: "Cancelled", icon: "filter", fg: "#FB7185", bg: "rgba(251,113,133,0.12)" },
  diverted: { label: "Diverted", icon: "route", fg: "#FFC061", bg: "rgba(255,192,97,0.12)" },
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
