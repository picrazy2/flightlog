import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { useFlights } from "@/data/useFlights";
import { Popover } from "@/components/ui/Popover";
import { Chevron } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { facetOptions, FACET_LABELS, type FacetCand } from "@/stats/facetOptions";

// Active drill-down filters, grouped by facet. Each chip is an OR group: clicking it
// opens a multi-select to add/remove values of that type; chips of different types AND.
export function FilterChips() {
  const { crossFilters, toggleCrossFilter, removeFacet, clearCrossFilters } = useStore();
  const all = useFlights().data ?? [];
  const options = useMemo(() => facetOptions(all), [all]);

  // group active filters by facet, preserving the order facets first appeared
  const groups: { facet: string; ids: Set<string>; labels: string[] }[] = [];
  const byFacet = new Map<string, { facet: string; ids: Set<string>; labels: string[] }>();
  for (const c of crossFilters) {
    const facet = c.id.split(":")[0];
    let g = byFacet.get(facet);
    if (!g) {
      g = { facet, ids: new Set(), labels: [] };
      byFacet.set(facet, g);
      groups.push(g);
    }
    g.ids.add(c.id);
    g.labels.push(c.label);
  }

  if (groups.length === 0) return null;

  return (
    <div className="pointer-events-auto flex items-center gap-2">
      {groups.map((g) => (
        <FilterChipGroup
          key={g.facet}
          facet={g.facet}
          ids={g.ids}
          labels={g.labels}
          options={options[g.facet] ?? []}
          onToggle={toggleCrossFilter}
          onRemove={() => removeFacet(g.facet)}
        />
      ))}
      {groups.length > 1 && (
        <button onClick={clearCrossFilters} className="focus-ring shrink-0 px-1.5 text-caption text-accent hover:underline">
          clear all
        </button>
      )}
    </div>
  );
}

function FilterChipGroup({
  facet,
  ids,
  labels,
  options,
  onToggle,
  onRemove,
}: {
  facet: string;
  ids: Set<string>;
  labels: string[];
  options: FacetCand[];
  onToggle: (f: FacetCand["filter"]) => void;
  onRemove: () => void;
}) {
  const [q, setQ] = useState("");
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = options.filter((o) => tokens.every((t) => o.label.toLowerCase().includes(t)));

  return (
    <Popover
      align="start"
      trigger={({ toggle, open }) => (
        <span
          className={cn(
            "inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full border border-accent pl-3 pr-1.5 text-label text-ink shadow-1 transition-colors",
            open ? "bg-[#1f3250]" : "bg-[#172338] hover:bg-[#1f3250]",
          )}
        >
          <button
            onClick={() => {
              if (!open) setQ("");
              toggle();
            }}
            className="focus-ring inline-flex items-center gap-1.5"
          >
            <span className="text-accent">{FACET_LABELS[facet] ?? facet}</span>
            <span className="max-w-[200px] truncate font-medium">
              {labels[0]}
              {labels.length > 1 && <span className="text-ink-muted"> +{labels.length - 1}</span>}
            </span>
            <Chevron dir="down" size={10} color="var(--accent)" />
          </button>
          <button
            onClick={onRemove}
            aria-label="Remove filter"
            className="focus-ring grid h-5 w-5 place-items-center rounded-full text-accent/70 hover:bg-[rgba(91,157,255,0.2)] hover:text-accent"
          >
            ✕
          </button>
        </span>
      )}
    >
      {() => (
        <div className="w-[240px]">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Filter ${FACET_LABELS[facet]?.toLowerCase() ?? facet}…`}
            className="focus-ring mb-2 w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-label text-ink placeholder:text-ink-faint"
          />
          <ul className="max-h-[260px] overflow-y-auto">
            {shown.map((o) => {
              const on = ids.has(o.id);
              return (
                <li key={o.id}>
                  <button onClick={() => onToggle(o.filter)} className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-label hover:bg-surface-2">
                    <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px]", on ? "border-accent bg-accent text-[var(--accent-ink)]" : "border-border")}>
                      {on ? "✓" : ""}
                    </span>
                    <span className={cn("min-w-0 flex-1 truncate", on ? "text-ink" : "text-ink-muted")}>{o.label}</span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-2 py-1.5 text-caption text-ink-faint">No matches</li>}
          </ul>
        </div>
      )}
    </Popover>
  );
}
