import type { Flight } from "./types";

// Widebody vs narrowbody — uses the aircraft_types.body_class from the DB; falls back to a
// name/code heuristic only when the reference row hasn't been enriched.
const WIDE_NAME = /(747|767|777|787|A300|A310|A330|A340|A350|A380|DC-?10|MD-?11|IL-?96|L-?1011)/i;
const WIDE_CODE = /^(B74|B76|B77|B78|A30|A310|A33|A34|A35|A38|DC10|MD11|IL96)/i;

export function isWidebody(f: Flight): boolean {
  if (f.aircraft_type_body_class) return f.aircraft_type_body_class === "widebody";
  const n = f.aircraft_type_name;
  if (n) return WIDE_NAME.test(n);
  return WIDE_CODE.test(f.aircraft_type_code ?? "");
}

export type BodyClass = "double" | "wide" | "narrow" | "unknown";

// Single source of truth for the map colouring, legend, cards, and the body cross-filter.
export function bodyClassOf(f: Flight): BodyClass {
  if (!f.aircraft_type_code) return "unknown";
  if (f.aircraft_type_deck_count === 2) return "double";
  return isWidebody(f) ? "wide" : "narrow";
}

export const BODY_LABELS: Record<BodyClass, string> = {
  double: "Double-decker",
  wide: "Widebody",
  narrow: "Narrowbody",
  unknown: "Unknown",
};
