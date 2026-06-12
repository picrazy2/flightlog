import type { Flight, Settings } from "./types";
import { useStore } from "@/state/store";
import { fromUSD, currencySymbol } from "./fx";

// Canonical actual times prefer WHEELS (takeoff/landing), falling back to gate.
export const actualDep = (f: Flight): string | null => f.actual_takeoff ?? f.actual_dep;
export const actualArr = (f: Flight): string | null => f.actual_landing ?? f.actual_arr;

// Scheduled times: prefer the airline schedule (provider) — it has the correct
// date/timezone (the user's CSV sched_arr is a day early on some overnight flights).
export const schedDep = (f: Flight): string => f.provider_sched_dep ?? f.sched_dep;
export const schedArr = (f: Flight): string => f.provider_sched_arr ?? f.sched_arr;

// Delay = gate actual vs gate schedule (airline convention) when available, else
// wheels actual vs user schedule. Returns minutes (null if no actual time).
export const departureDelayMin = (f: Flight): number | null => {
  const a = f.actual_dep ?? f.actual_takeoff;
  return a == null ? null : Math.round((Date.parse(a) - Date.parse(schedDep(f))) / 60000);
};
export const arrivalDelayMin = (f: Flight): number | null => {
  const a = f.actual_arr ?? f.actual_landing;
  return a == null ? null : Math.round((Date.parse(a) - Date.parse(schedArr(f))) / 60000);
};

// Distance follows the "Show tracks" toggle: in tracks mode prefer the actual flown
// track distance (incl. GC fillers), then the filed route distance, then great-circle;
// in great-circle mode use great-circle only.
export const flightDistanceMi = (f: Flight): number => {
  const preferActual = useStore.getState().settings.showTracks;
  if (preferActual) return f.flown_distance_mi ?? f.route_distance_mi ?? f.distance_mi ?? 0;
  return f.distance_mi ?? 0;
};

// Scheduled block duration using provider-preferred schedule (correct dates).
export const schedDurationMin = (f: Flight): number => durationMin(schedDep(f), schedArr(f));

// Actual flight time: wheels-up → wheels-down (air time) when available, else the
// scheduled block duration.
export const flightMinutes = (f: Flight): number =>
  f.actual_takeoff && f.actual_landing ? durationMin(f.actual_takeoff, f.actual_landing) : schedDurationMin(f);

const MI_TO_KM = 1.60934;

// Compact, max 3 significant figures: 492, 1.23, 49.2, 1.21k, 121k, 32.1m, 1.59b.
export function compact(n: number): string {
  if (!isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  let x = Math.abs(n);
  const units = ["", "k", "m", "b", "t"];
  let u = 0;
  while (x >= 1000 && u < units.length - 1) {
    x /= 1000;
    u += 1;
  }
  let s = x.toPrecision(3);
  if (s.indexOf(".") >= 0) s = s.replace(/\.?0+$/, "");
  return sign + s + units[u];
}

export function formatDistance(miles: number, settings: Settings): { value: string; unit: string } {
  const v = settings.units === "km" ? miles * MI_TO_KM : miles;
  return { value: compact(v), unit: settings.units };
}

// Standardized duration: <60min → "45 min"; <24h → "12h 30m"; ≥24h → "3d 4h".
export function formatDuration(minutes: number): { value: string; unit: string } {
  const m = Math.round(minutes);
  if (m < 60) return { value: `${m} min`, unit: "" };
  if (m < 1440) return { value: `${Math.floor(m / 60)}h ${m % 60}m`, unit: "" };
  const d = Math.floor(m / 1440);
  const h = Math.round((m % 1440) / 60);
  return { value: `${d.toLocaleString()}d ${h}h`, unit: "" };
}

// Same standard, used on stat cards.
export const formatDurationCompact = formatDuration;

export function formatInt(n: number): string {
  return compact(n);
}

export function formatUSD(n: number): { value: string; unit: string } {
  return { value: `$${compact(n)}`, unit: "" };
}

// A USD amount rendered in the user's chosen display currency.
export function formatMoney(usd: number, currency: string): { value: string; unit: string } {
  return { value: `${currencySymbol(currency)}${compact(fromUSD(usd, currency))}`, unit: "" };
}

export function formatPoints(n: number): { value: string; unit: string } {
  return { value: compact(n), unit: "pts" };
}

export function formatPct(n: number): { value: string; unit: string } {
  return { value: `${Math.round(n)}%`, unit: "" };
}

// minutes between two ISO instants
export function durationMin(depIso: string, arrIso: string): number {
  return (new Date(arrIso).getTime() - new Date(depIso).getTime()) / 60_000;
}

// Local hour (0–23) at a given IANA timezone — for red-eye / time-of-day which must
// use the departure airport's local time, not the viewer's browser timezone.
export function localHour(iso: string, tz: string | null): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: tz ?? "UTC" }).format(
        new Date(iso),
      ),
    );
  } catch {
    return new Date(iso).getHours();
  }
}

export function deltaPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}
