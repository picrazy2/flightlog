import type { CrossFilter, DateRange } from "@/state/store";

// What clicking a fact row does. `flight` opens that flight's map popup; `filter`
// toggles a cross-filter; `range` sets the date range.
export type FactAction =
  | { kind: "filter"; filter: CrossFilter }
  | { kind: "range"; range: DateRange }
  | { kind: "flight"; flightId: string };

export interface Fact {
  label: string;
  value: string;
  sub?: string;
  action?: FactAction; // when set (and onAction is provided) the row is clickable
}

// Compact "fun facts / rankings" rows for panels (longest/shortest, etc.).
export function FactList({ title, facts, onAction }: { title: string; facts: Fact[]; onAction?: (a: FactAction) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-eyebrow tracking-[0.01em] text-ink-faint">{title}</div>
      <ul className="flex flex-col divide-y divide-border">
        {facts.map((f, i) => {
          const clickable = !!(f.action && onAction);
          const body = (
            <>
              <span className="text-label text-ink-muted">{f.label}</span>
              <span className="flex items-baseline gap-1.5 text-right">
                <span className="tnum text-label font-medium text-ink">{f.value}</span>
                {f.sub && <span className="text-caption text-ink-faint">{f.sub}</span>}
              </span>
            </>
          );
          return (
            <li key={i}>
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onAction!(f.action!)}
                  className="focus-ring flex w-full items-center justify-between gap-3 py-1.5 text-left hover:opacity-80"
                >
                  {body}
                </button>
              ) : (
                <div className="flex items-center justify-between gap-3 py-1.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
