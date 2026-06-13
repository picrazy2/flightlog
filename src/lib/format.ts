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

// Local calendar date (YYYY-MM-DD) of a UTC ISO timestamp, in the given timezone.
export const localDate = (iso: string, tz: string | null): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
// Display date for a flight = the departure local date from the provider-preferred
// schedule (falls back to the stored flight_date if anything is off).
export const schedDate = (f: Flight): string => {
  try {
    return localDate(schedDep(f), f.dep_timezone ?? null);
  } catch {
    return f.flight_date;
  }
};

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
// Decimal places by magnitude: ≥100 → 0, 10–100 → 1, <10 → 2.
export const smartDecimals = (n: number): number => {
  const a = Math.abs(n);
  return a >= 100 ? 0 : a >= 10 ? 1 : 2;
};

// Full number (locale-grouped) rounded by magnitude — e.g. 52345.6 → "52,346", 5.234 → "5.23".
export function smartNum(n: number): string {
  if (!isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: smartDecimals(n) });
}

// Abbreviated for cards/axes: 2 significant figures, except a 3-integer-digit value
// (100–999) keeps all 3. So 94,230→94k, 101,123→101k, 8,923→8.9k, 823.2→823, 8.42→8.4,
// 0.123→0.12.
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
  if (x === 0) return "0";
  const sig = x >= 100 ? 3 : 2;
  const decimals = Math.max(0, sig - 1 - Math.floor(Math.log10(x)));
  let s = x.toFixed(decimals);
  if (s.indexOf(".") >= 0) s = s.replace(/\.?0+$/, "");
  return sign + s + units[u];
}

// `full` is the un-abbreviated value (for card hover): "12,345 mi", "$52,345", etc.
const grouped = (n: number) => Math.round(n).toLocaleString();

export function formatDistance(miles: number, settings: Settings): { value: string; unit: string; full: string } {
  const v = settings.units === "km" ? miles * MI_TO_KM : miles;
  return { value: compact(v), unit: settings.units, full: `${grouped(v)} ${settings.units}` };
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

export function formatUSD(n: number): { value: string; unit: string; full: string } {
  return { value: `$${compact(n)}`, unit: "", full: `$${grouped(n)}` };
}

// A USD amount rendered in the user's chosen display currency.
export function formatMoney(usd: number, currency: string): { value: string; unit: string; full: string } {
  const v = fromUSD(usd, currency);
  return { value: `${currencySymbol(currency)}${compact(v)}`, unit: "", full: `${currencySymbol(currency)}${grouped(v)}` };
}

export function formatPoints(n: number): { value: string; unit: string; full: string } {
  return { value: compact(n), unit: "pts", full: `${grouped(n)} pts` };
}

// Percentages: ≥10 → integer, 1–10 → one decimal, <1 → two decimals.
export function formatPct(n: number): { value: string; unit: string; full: string } {
  const a = Math.abs(n);
  const dp = a >= 10 ? 0 : a >= 1 ? 1 : 2;
  return { value: `${n.toFixed(dp)}%`, unit: "", full: `${n.toFixed(Math.max(1, dp))}%` };
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
