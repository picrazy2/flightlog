export interface Fact {
  label: string;
  value: string;
  sub?: string;
}

// Compact "fun facts / rankings" rows for panels (longest/shortest, etc.).
export function FactList({ title, facts }: { title: string; facts: Fact[] }) {
  return (
    <div>
      <div className="mb-1.5 text-eyebrow tracking-[0.01em] text-ink-faint">{title}</div>
      <ul className="flex flex-col divide-y divide-border">
        {facts.map((f, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-label text-ink-muted">{f.label}</span>
            <span className="flex items-baseline gap-1.5 text-right">
              <span className="tnum text-label font-medium text-ink">{f.value}</span>
              {f.sub && <span className="text-caption text-ink-faint">{f.sub}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
