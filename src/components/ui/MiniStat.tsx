export interface MiniStatItem {
  label: string;
  value: string;
  color?: string; // optional accent dot
}

// Compact in-panel metric cards (a small row of figures above a chart).
export function MiniStats({ items }: { items: MiniStatItem[] }) {
  return (
    // grid align-items:stretch → all cards in the row share the tallest height even
    // when some labels wrap to a second line
    <div className="grid items-stretch gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
      {items.map((it, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface-1 px-2.5 py-2 shadow-1">
          <div className="tnum font-display text-[1.15rem] font-bold leading-none text-ink">{it.value}</div>
          <div className="mt-1 flex items-start gap-1">
            {it.color && <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: it.color }} />}
            <span className="text-caption leading-snug text-ink-muted">{it.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
