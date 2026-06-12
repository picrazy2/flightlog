import type { Flight } from "./types";

// Some carriers operate under more than one IATA code (e.g. Ryanair FR + Ryanair UK RK).
// Collapse the aliases to one canonical code so airline grouping/colouring/filtering treats
// them as a single airline everywhere.
const ALIAS: Record<string, string> = {
  RK: "FR", // Ryanair UK → Ryanair
};
// Display name override for a canonical code (when the per-flight name varies, e.g. some
// rows say "Ryanair UK").
const NAME: Record<string, string> = {
  FR: "Ryanair",
};

export const airlineKey = (iata: string | null | undefined): string => (iata ? ALIAS[iata] ?? iata : "");

// Canonical display name: prefer the override, else the flight's own name, else the code.
export const airlineLabel = (iata: string | null | undefined, fallbackName?: string | null): string => {
  const k = airlineKey(iata);
  return NAME[k] ?? fallbackName ?? k;
};

export const airlineNameOf = (f: Flight): string => airlineLabel(f.airline_iata, f.airline_name);
