export interface MiniStatItem {
  label: string;
  value: string;
  color?: string; // optional accent dot
  onClick?: () => void; // makes the card a button (e.g. apply a cross-filter)
  active?: boolean; // highlight when its filter is applied
}

// Compact in-panel metric cards (a small row of figures above a chart). `cols` forces a
// fixed column count (e.g. 3) so a longer list wraps into multiple rows.
export function MiniStats({ items, cols }: { items: MiniStatItem[]; cols?: number }) {
  return (
    // grid align-items:stretch → all cards in the row share the tallest height even
    // when some labels wrap to a second line
    <div className="grid items-stretch gap-2" style={{ gridTemplateColumns: `repeat(${cols ?? items.length}, minmax(0,1fr))` }}>
      {items.map((it, i) => {
        const inner = (
          <>
            <div className="tnum font-display text-[1.15rem] font-bold leading-none text-ink">{it.value}</div>
            <div className="mt-1 flex items-start gap-1">
              {it.color && <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: it.color }} />}
              <span className="text-caption leading-snug text-ink-muted">{it.label}</span>
            </div>
          </>
        );
        const base = "rounded-lg border bg-surface-1 px-2.5 py-2 text-left shadow-1";
        return it.onClick ? (
          <button
            key={i}
            onClick={it.onClick}
            className={`focus-ring ${base} ${it.active ? "border-accent ring-1 ring-accent" : "border-border hover:bg-surface-2"}`}
          >
            {inner}
          </button>
        ) : (
          <div key={i} className={`${base} border-border`}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
