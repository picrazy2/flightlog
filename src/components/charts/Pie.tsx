import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import { useIsMobile } from "@/lib/useIsMobile";

export interface Slice {
  id: string;
  label: string;
  value: number;
  color: string;
}

interface Props {
  slices: Slice[];
  onPick?: (id: string) => void;
  unit?: string;
  height?: number;
  activeId?: string | null | string[]; // selected slice id(s); others dim
}

// Donut chart with a legend list. Caller supplies the slices (incl. an "Other").
export function PieSlices({ slices, onPick, unit, height, activeId }: Props) {
  // on touch (mobile/tablet), tapping a slice shows its tooltip (the only "hover"), so it
  // shouldn't filter; the legend list below stays tappable for filtering
  const pick = useIsMobile(1024) ? undefined : onPick;
  const hasActive = Array.isArray(activeId) ? activeId.length > 0 : activeId != null;
  const isActive = (id: string) => (Array.isArray(activeId) ? activeId.includes(id) : id === activeId);
  return (
    <div>
      <div style={{ height: height ?? 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={1}
              stroke="none"
              isAnimationActive={false}
              cursor={pick ? "pointer" : undefined}
              onClick={(d: { id?: string }) => d?.id && pick?.(d.id)}
            >
              {slices.map((s) => (
                <Cell key={s.id} fill={s.color} fillOpacity={hasActive && !isActive(s.id) ? 0.3 : 1} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip unit={unit} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {slices.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onPick?.(s.id)}
              className={`focus-ring inline-flex items-center gap-1.5 text-caption hover:text-ink ${hasActive && !isActive(s.id) ? "text-ink-faint" : "text-ink-muted"}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
