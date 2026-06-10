import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Flight, Settings } from "@/lib/types";

// A drill-down filter created by clicking a chart bar / map feature. Generic:
// the module supplies the predicate, the shell just AND-applies them.
export interface CrossFilter {
  id: string; // unique per facet+value, e.g. "year:2023"
  label: string; // chip text, e.g. "2023"
  test: (f: Flight) => boolean;
}

export interface DateRange {
  start: string | null; // YYYY-MM-DD inclusive; null = open
  end: string | null;
  label: string; // "All time", "2023", "Q2 2024"…
}

export const ALL_TIME: DateRange = { start: null, end: null, label: "All time" };

// the user whose log we're viewing comes from the URL path after the app's base
// (e.g. /journia/alex → "alex"), default "alex"
const BASE = import.meta.env.BASE_URL; // "/" in dev, "/journia/" in prod
const userFromPath = (): string => {
  if (typeof window === "undefined") return "alex";
  let path = window.location.pathname;
  if (path.startsWith(BASE)) path = path.slice(BASE.length);
  const seg = path.replace(/^\/+/, "").split("/")[0];
  return seg || "alex";
};

// legend toggles: per encoding key, which series are switched off
export type LegendFilter = Record<string, boolean>; // key -> isOff

// mobile: which bottom drawer is expanded, and what map feature is selected (the
// "popup" drawer's content). On desktop these are unused (popups render on the map).
export type DrawerId = "legend" | "stats" | "popup";
export type MapSelection =
  | { kind: "flight"; flightId: string }
  | { kind: "routeAgg"; rk: string; dep: string; arr: string }
  | { kind: "airport"; iata: string; name: string; city: string; visits: number };

interface AppState {
  range: DateRange;
  compare: boolean;
  activeModuleId: string | null; // which stat panel is open / driving the map
  settings: Settings;
  legendFilter: LegendFilter;
  crossFilters: CrossFilter[];
  projection: "mercator" | "globe";
  temporal: "all" | "past" | "future";
  dbOpen: boolean;
  immersive: boolean; // hide all chrome except the exit button
  showAirports: boolean; // airport markers visible on the map
  userId: string; // whose log is shown (from the URL path)
  mapSelection: MapSelection | null; // mobile: selected route/airport (popup drawer)
  mobileOpen: DrawerId | null; // mobile: which bottom drawer is expanded

  setRange: (r: DateRange) => void;
  toggleCompare: () => void;
  setActiveModule: (id: string | null) => void;
  setSettings: (patch: Partial<Settings>) => void;
  toggleLegend: (key: string) => void;
  isolateLegend: (key: string, allKeys: string[]) => void;
  clearLegend: () => void;
  toggleCrossFilter: (f: CrossFilter) => void;
  removeCrossFilter: (id: string) => void;
  removeFacet: (facet: string) => void;
  clearCrossFilters: () => void;
  toggleProjection: () => void;
  setTemporal: (t: "all" | "past" | "future") => void;
  setDbOpen: (v: boolean) => void;
  toggleImmersive: () => void;
  toggleAirports: () => void;
  setUserId: (id: string) => void;
  setMapSelection: (s: MapSelection | null) => void;
  setMobileOpen: (d: DrawerId | null) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
  range: ALL_TIME,
  compare: true, // comparison on by default; grey deltas when the range has no valid prior period
  activeModuleId: null,
  settings: { units: "mi", showTracks: true, markEstimated: true },
  legendFilter: {},
  crossFilters: [],
  projection: "mercator",
  temporal: "all",
  dbOpen: false,
  immersive: false,
  showAirports: true,
  userId: userFromPath(),
  mapSelection: null,
  mobileOpen: null,

  // Changing the range via the picker supersedes any year drill-down chip.
  setRange: (range) => set((s) => ({ range, crossFilters: s.crossFilters.filter((c) => !c.id.startsWith("year:")) })),
  toggleCompare: () => set((s) => ({ compare: !s.compare })),
  setActiveModule: (id) =>
    set((s) => {
      const activeModuleId = s.activeModuleId === id ? null : id;
      // mobile: opening a module expands the stats drawer; closing collapses it
      const mobileOpen = activeModuleId ? "stats" : s.mobileOpen === "stats" ? null : s.mobileOpen;
      return { activeModuleId, legendFilter: {}, mobileOpen };
    }),
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  toggleLegend: (key) =>
    set((s) => ({ legendFilter: { ...s.legendFilter, [key]: !s.legendFilter[key] } })),
  isolateLegend: (key, allKeys) =>
    set(() => {
      const off: LegendFilter = {};
      for (const k of allKeys) off[k] = k !== key;
      return { legendFilter: off };
    }),
  clearLegend: () => set({ legendFilter: {} }),
  toggleCrossFilter: (f) =>
    set((s) => ({
      crossFilters: s.crossFilters.some((c) => c.id === f.id)
        ? s.crossFilters.filter((c) => c.id !== f.id)
        : [...s.crossFilters, f],
    })),
  removeCrossFilter: (id) => set((s) => ({ crossFilters: s.crossFilters.filter((c) => c.id !== id) })),
  removeFacet: (facet) => set((s) => ({ crossFilters: s.crossFilters.filter((c) => c.id.split(":")[0] !== facet) })),
  clearCrossFilters: () => set({ crossFilters: [] }),
  toggleProjection: () => set((s) => ({ projection: s.projection === "globe" ? "mercator" : "globe" })),
  setTemporal: (temporal) => set({ temporal }),
  setDbOpen: (dbOpen) => set({ dbOpen }),
  toggleImmersive: () => set((s) => ({ immersive: !s.immersive })),
  toggleAirports: () => set((s) => ({ showAirports: !s.showAirports })),
  // switching user updates the URL (/alex) and resets drill-down view state
  setUserId: (userId) => {
    if (typeof window !== "undefined") window.history.pushState(null, "", `${BASE}${userId}`);
    set({ userId, crossFilters: [], range: ALL_TIME, activeModuleId: null });
  },
  setMapSelection: (mapSelection) =>
    set((s) => ({ mapSelection, mobileOpen: mapSelection ? "popup" : s.mobileOpen === "popup" ? null : s.mobileOpen })),
  setMobileOpen: (mobileOpen) => set({ mobileOpen }),
    }),
    {
      name: "journia-settings",
      // persist display preferences only — not transient view state (filters,
      // open panel, date range) or the non-serialisable cross-filter predicates
      partialize: (s) => ({
        settings: s.settings,
        projection: s.projection,
        showAirports: s.showAirports,
        compare: s.compare,
      }),
      // deep-merge so settings keys added in future builds keep their defaults
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return { ...current, ...p, settings: { ...current.settings, ...(p.settings ?? {}) } };
      },
    },
  ),
);
