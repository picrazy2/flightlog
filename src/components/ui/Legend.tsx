import { cn } from "@/lib/cn";
import { useStore } from "@/state/store";
import { Icon } from "./Icon";
import type { LegendModel } from "@/stats/types";

// Interactive map legend (bottom-right). Items that carry a `filter` apply a GLOBAL
// cross-filter on click (first click isolates to that value; click again clears it;
// extra clicks OR more in). Items without a filter fall back to local show/hide with
// isolate-first semantics. Reset clears whatever this legend has active.
export function Legend({ model, fluid }: { model: LegendModel; fluid?: boolean }) {
  const { legendFilter, toggleLegend, isolateLegend, clearLegend, showAirports, toggleAirports, crossFilters, toggleCrossFilter, removeFacet } = useStore();
  const allKeys = model.items.map((i) => i.id);
  const activeIds = new Set(crossFilters.map((c) => c.id));
  const facets = [...new Set(model.items.map((i) => i.filter?.id.split(":")[0]).filter(Boolean) as string[])];
  const anyCrossActive = model.items.some((i) => i.filter && activeIds.has(i.filter.id));
  const anyOff = allKeys.some((k) => legendFilter[k]);
  const anyActive = anyCrossActive || anyOff;

  const reset = () => {
    clearLegend();
    for (const f of facets) removeFacet(f);
  };

  const onItem = (id: string, filter: LegendModel["items"][number]["filter"]) => {
    // cross-filter items: toggle naturally isolates from "all shown", then ORs more in
    if (filter) {
      toggleCrossFilter(filter);
      return;
    }
    // local show/hide: when everything's shown, a click isolates to that one; once a
    // subset is showing, a click just adds/removes that one (clearing back to all if
    // it was the last one still showing)
    if (!anyOff) {
      isolateLegend(id, allKeys);
      return;
    }
    const shown = allKeys.filter((k) => !legendFilter[k]);
    if (!legendFilter[id] && shown.length === 1) clearLegend();
    else toggleLegend(id);
  };

  return (
    <div className={fluid ? "w-full" : "glass w-fit max-w-[200px] rounded-xl p-3"}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-eyebrow tracking-[0.01em] text-ink-faint">{model.title}</span>
        {anyActive && (
          <button onClick={reset} className="focus-ring text-caption text-accent hover:underline">
            reset
          </button>
        )}
      </div>
      <ul className={fluid ? "grid grid-cols-2 gap-1" : "flex flex-col gap-1"}>
        <li>
          <button
            onClick={toggleAirports}
            className={cn(
              "focus-ring flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-label transition-opacity hover:bg-surface-2",
              showAirports ? "opacity-100" : "opacity-35",
            )}
          >
            <Icon name="plane" size={11} className="shrink-0" />
            <span className="truncate text-ink">Airports</span>
          </button>
        </li>
        {model.items.map((it) => {
          const active = it.filter ? activeIds.has(it.filter.id) : false;
          // dim when something in this legend is active and this item isn't part of it
          const dimmed = it.filter ? anyCrossActive && !active : legendFilter[it.id];
          return (
            <li key={it.id}>
              <button
                onClick={() => onItem(it.id, it.filter)}
                className={cn(
                  "focus-ring flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-label transition-opacity hover:bg-surface-2",
                  dimmed ? "opacity-35" : "opacity-100",
                )}
              >
                <span
                  className={cn("shrink-0", it.swatch === "line" ? "h-0.5 w-4 rounded-full" : "h-2.5 w-2.5 rounded-full")}
                  style={{ backgroundColor: it.color }}
                />
                <span className="truncate text-ink">{it.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
