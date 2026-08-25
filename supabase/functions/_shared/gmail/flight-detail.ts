import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Shared renderer for the "here is exactly what was recorded" flight blocks.
//
// Both reporting paths use it — the inbox-scan run notification and the reply to a
// forwarded email — so a flight filed either way is reported in the same shape. The
// point of the format is verification: every derived field is printed, including the
// ones that came back empty, so a missed airline match or a dropped fare is visible
// immediately rather than months later.

// Shown in place of an empty field. Deliberately conspicuous: a blank would read as
// "not applicable", but every one of these fields should normally resolve.
const MISSING = "— not set —";

const FLIGHT_COLUMNS =
  "id, booking_id, flight_date, airline_iata, flight_number, dep_iata, arr_iata, status, " +
  "cabin_class, aircraft_type_name, cost_cash, cost_currency, cost_points, points_program, " +
  "airline_name, alliance, sched_dep, sched_arr, dep_timezone, arr_timezone, " +
  "dep_name, dep_city, dep_country_name, arr_name, arr_city, arr_country_name, " +
  "distance_mi, aircraft_type_code, aircraft_type_manufacturer, registration, " +
  "cost_cash_usd, cost_cash_segment, cost_cash_segment_usd, cost_points_segment, " +
  "booking_platform, trip_type, source, " +
  "terminal_origin, terminal_destination";

export interface FlightDetail {
  /** One multi-line block per flight, oldest first. */
  blocks: string[];
  /** One line per flight that has unresolved fields; empty when everything resolved. */
  gaps: string[];
}

/** Render full detail blocks for the given flight ids. Returns empty for an empty list. */
export async function buildFlightDetail(
  supabase: SupabaseClient,
  ids: string[],
): Promise<FlightDetail> {
  if (ids.length === 0) return { blocks: [], gaps: [] };

  // The view carries denormalized airline / airport / aircraft / cost, so one query has
  // everything the blocks need.
  const { data } = await supabase
    .from("v_flights_with_airports")
    .select(FLIGHT_COLUMNS)
    .in("id", ids);
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  if (rows.length === 0) return { blocks: [], gaps: [] };

  // Booking rows add PNR, platform, and a link to the source email so each block can be
  // sanity-checked against Gmail.
  const bookingIds = [...new Set(rows.map((r) => r.booking_id).filter(Boolean))];
  const bookingById = new Map<string, Record<string, unknown>>();
  if (bookingIds.length) {
    const { data: bks } = await supabase
      .from("bookings")
      .select("id, booking_refs_airline, booking_ref_platform, emails")
      .in("id", bookingIds as string[]);
    for (const b of (bks ?? []) as Array<Record<string, unknown>>) {
      bookingById.set(String(b.id), b);
    }
  }

  const blocks = rows
    .sort((a, b) => String(a.flight_date).localeCompare(String(b.flight_date)))
    .map((f) => {
      const head = `  ${f.flight_date}  ${f.airline_iata}${f.flight_number}  ` +
        `${f.dep_iata} → ${f.arr_iata}`;
      const b = f.booking_id ? bookingById.get(String(f.booking_id)) : undefined;
      const refs = (b?.booking_refs_airline ?? []) as Array<{ pnr?: string }>;
      const pnr = refs.map((x) => x?.pnr).filter(Boolean).join(",") ||
        (b?.booking_ref_platform as string | undefined) || "";
      const emails = (b?.emails ?? []) as Array<{ message_id?: string; kind?: string }>;
      // Link to the most relevant email: the cancellation for a cancelled leg, otherwise
      // the original booking, falling back to whatever is recorded.
      const preferKind = f.status === "cancelled" ? "cancellation" : "booking";
      const mid = (emails.find((e) => e.kind === preferKind) ??
        emails.find((e) => e.kind === "booking") ?? emails[0])?.message_id;
      const link = mid ? `https://mail.google.com/mail/u/0/#all/${mid}` : "";

      if (f.status === "cancelled") {
        return `${head}  (CANCELLED)${pnr ? `  PNR ${pnr}` : ""}${link ? `\n      ↳ ${link}` : ""}`;
      }

      const field = (label: string, value: unknown) =>
        `      ${label.padEnd(11)} ${value == null || value === "" ? MISSING : value}`;

      const airline = f.airline_name
        ? `${f.airline_name} (${f.airline_iata})${f.alliance ? ` · ${f.alliance}` : ""}`
        : null;
      const aircraft = f.aircraft_type_name
        ? [f.aircraft_type_manufacturer, f.aircraft_type_name].filter(Boolean).join(" ") +
          (f.aircraft_type_code ? ` (${f.aircraft_type_code})` : "") +
          (f.registration ? ` · ${f.registration}` : "")
        : null;
      const from = `${f.dep_iata} ${f.dep_name ?? ""}`.trim() +
        (f.dep_city ? ` — ${f.dep_city}, ${f.dep_country_name ?? ""}`.trimEnd() : "") +
        (f.terminal_origin ? ` · T${f.terminal_origin}` : "");
      const to = `${f.arr_iata} ${f.arr_name ?? ""}`.trim() +
        (f.arr_city ? ` — ${f.arr_city}, ${f.arr_country_name ?? ""}`.trimEnd() : "") +
        (f.terminal_destination ? ` · T${f.terminal_destination}` : "");

      return [
        head,
        field("airline", airline),
        field("aircraft", aircraft),
        field("from", from),
        field("to", to),
        field("departs", formatWhen(f.sched_dep, f.dep_timezone)),
        field("arrives", formatWhen(f.sched_arr, f.arr_timezone)),
        field("distance", f.distance_mi == null ? null : `${Math.round(Number(f.distance_mi))} mi`),
        field("cabin", f.cabin_class ? formatCabin(String(f.cabin_class)) : null),
        field("cost", formatFullCost(f)),
        field(
          "booking",
          [pnr ? `PNR ${pnr}` : null, f.booking_platform, f.trip_type]
            .filter(Boolean).join(" · ") || null,
        ),
        field("source", f.source),
        link ? `      ↳ verify:    ${link}` : null,
      ].filter(Boolean).join("\n");
    });

  // Roll the per-flight gaps up into one list, so a partial import is actionable rather
  // than only visible to someone reading every block closely.
  const gaps = rows
    .filter((f) => f.status !== "cancelled")
    .map((f) => {
      // Aircraft is never parsed from an email — there is no field for it in the Gemini
      // schema; it arrives from the provider once the flight has operated. Flagging it on
      // an upcoming flight would fire on every future import and teach the reader to skip
      // this whole section, so it only counts as missing once the flight has flown.
      const flown = f.status !== "scheduled";
      const missing = [
        f.airline_name ? null : "airline",
        flown && !f.aircraft_type_name ? "aircraft" : null,
        f.distance_mi == null ? "distance" : null,
        f.cabin_class ? null : "cabin",
        formatFullCost(f) ? null : "cost",
      ].filter(Boolean);
      return missing.length
        ? `  ${f.airline_iata}${f.flight_number} ${f.dep_iata}→${f.arr_iata}: ${missing.join(", ")}`
        : null;
    })
    .filter(Boolean) as string[];

  return { blocks, gaps };
}

export function formatCabin(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Cash and points are not exclusive (a points booking still carries cash taxes), so this
// reports both, plus the USD conversion actually stored.
//
// The LEG's own share leads, not the booking total: a return booking printed its full
// fare against every leg, which reads as if each leg cost the whole thing. The total is
// still shown when it differs, so a multi-leg booking is legible either way.
export function formatFullCost(f: Record<string, unknown>): string | null {
  const cur = (f.cost_currency as string | null) ?? "";
  const parts: string[] = [];

  const cash = f.cost_cash_segment ?? f.cost_cash;
  const cashUsd = f.cost_cash_segment != null ? f.cost_cash_segment_usd : f.cost_cash_usd;
  if (cash != null) {
    const usd = cashUsd != null && cur !== "USD"
      ? ` (≈ ${Number(cashUsd).toFixed(2)} USD)`
      : "";
    let line = `${cash} ${cur}`.trim() + usd;
    if (f.cost_cash != null && Number(f.cost_cash) !== Number(cash)) {
      line += ` · ${`${f.cost_cash} ${cur}`.trim()} booking total`;
    }
    parts.push(line);
  }

  const points = f.cost_points_segment ?? f.cost_points;
  if (points != null) {
    parts.push(`${points} ${f.points_program ?? "pts"}`.trim());
  }

  return parts.length ? parts.join(" + ") : null;
}

// Scheduled times are stored as timestamptz but only mean anything to a traveller in the
// airport's own local time, so render each end in its own zone and name the zone.
export function formatWhen(value: unknown, timezone: unknown): string | null {
  if (!value) return null;
  const at = new Date(String(value));
  if (Number.isNaN(at.getTime())) return null;
  const tz = typeof timezone === "string" && timezone ? timezone : "UTC";
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
    return `${formatted} (${tz})`;
  } catch {
    return `${at.toISOString().replace("T", " ").slice(0, 16)} (UTC)`;
  }
}
