import { useMemo } from "react";
import { useFlights } from "@/data/useFlights";
import { useStore, type DateRange } from "@/state/store";
import { airportsFrom } from "@/lib/aggregate";
import type { Flight } from "@/lib/types";
import type { StatContext } from "./types";

function inRange(f: Flight, r: DateRange): boolean {
  if (r.start && f.flight_date < r.start) return false;
  if (r.end && f.flight_date > r.end) return false;
  return true;
}

// Previous period of equal length immediately before [start,end].
function previousRange(r: DateRange): DateRange | null {
  if (!r.start || !r.end) return null;
  const start = new Date(r.start).getTime();
  const end = new Date(r.end).getTime();
  const span = end - start;
  const prevEnd = new Date(start - 86_400_000);
  const prevStart = new Date(start - 86_400_000 - span);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(prevStart), end: iso(prevEnd), label: "Previous period" };
}

// Build the StatContext once per (data, range, compare, settings, legend) change.
export function useStatContext(): { ctx: StatContext | null; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useFlights();
  const { range, compare, settings, legendFilter, crossFilters, temporal } = useStore();

  const ctx = useMemo<StatContext | null>(() => {
    if (!data) return null;
    const today = new Date().toISOString().slice(0, 10);
    const passesTemporal = (f: (typeof data)[number]) =>
      temporal === "all" || (temporal === "past" ? f.flight_date <= today : f.flight_date > today);
    // group cross-filters by facet (the id prefix): OR within a facet, AND across
    // facets — so two "airline:" chips match either airline, but airline AND city.
    const facetGroups = new Map<string, typeof crossFilters>();
    for (const c of crossFilters) {
      const facet = c.id.split(":")[0];
      const g = facetGroups.get(facet) ?? [];
      g.push(c);
      facetGroups.set(facet, g);
    }
    const groups = [...facetGroups.values()];
    const passesCross = (f: (typeof data)[number]) => groups.every((g) => g.some((c) => c.test(f)));
    const flights = data.filter((f) => inRange(f, range) && passesTemporal(f) && passesCross(f));

    // A facet's own chart should not be narrowed by its own selections (else clicking
    // one bar hides the rest and you can't add a second). Filter by all OTHER facets.
    const facetFlights = (facet: string) => {
      const others = [...facetGroups.entries()].filter(([k]) => k !== facet).map(([, g]) => g);
      return data.filter(
        (f) => inRange(f, range) && passesTemporal(f) && others.every((g) => g.some((c) => c.test(f))),
      );
    };

    // A bounded range compares to the immediately-preceding equal-length window
    // (a ▲/▼ delta). All-time has no meaningful previous period → no comparison.
    let compareFlights: Flight[] | null = null;
    let compareMode: "delta" | "recent" | null = null;
    if (compare && (range.start || range.end)) {
      const prev = previousRange(range);
      if (prev) {
        compareFlights = data.filter((f) => inRange(f, prev) && passesTemporal(f) && passesCross(f));
        compareMode = "delta";
      }
    }

    return {
      flights,
      facetFlights,
      compareFlights,
      airports: airportsFrom(flights),
      settings,
      legendFilter,
      crossFilterIds: crossFilters.map((c) => c.id),
      compareMode,
    };
  }, [data, range, compare, settings, legendFilter, crossFilters, temporal]);

  return { ctx, isLoading, error };
}
