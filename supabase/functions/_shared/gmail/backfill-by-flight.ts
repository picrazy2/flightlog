import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { upsertBookingIfPresent } from "../flights/bookings.ts";
import { recomputeBookingSegmentCost } from "../flights/segment-cost.ts";
import {
  fetchMessages,
  type GmailMessage,
  listMessageIdsBySearch,
  refreshGmailAccessToken,
} from "./gmail-client.ts";
import { parseEmailForFlights } from "./gemini-parser.ts";
import type { GeminiOwner } from "./gemini-parser.ts";
import { buildBookingInput, hasBookingContent, linkBooking } from "./watch-gmail.ts";

// Flight-anchored booking backfill: use the already-imported flights as the source of
// truth, search Gmail for each flight's number ("UA123" / "UA 123") within a window
// around the flight, let Gemini parse the candidates, and attach the booking
// (cost/points/PNR) only to flights whose date + route the email actually matches. It
// never creates flights and never changes a stored flight number — a number mismatch is
// recorded as a discrepancy note instead. Cancellations are skipped (Pass 1).

const PROCESSED_KEY = (user: string) => `backfill_by_flight:${user}`;

type KnownFlight = {
  id: string;
  flight_date: string;
  airline_iata: string;
  flight_number: string;
  dep_iata: string;
  arr_iata: string;
  booking_id: string | null;
};

export type BackfillByFlightConfig = {
  userId: string;
  gmailClientId: string;
  gmailClientSecret: string;
  gmailRefreshToken: string;
  geminiApiKey: string;
  owner?: GeminiOwner;
  limit?: number; // messages to Gemini-parse this call (timeout-safe batching)
  monthsBefore?: number; // search window before each flight; default 12
};

export type BackfillByFlightResult = {
  flights: number;
  candidates: number;
  processed_now: number;
  remaining: number;
  bookings_linked: number;
  flights_with_booking: number;
  discrepancies: string[];
  unmatched_legs: string[];
  results: Array<{ message_id: string; subject: string; outcome: string; flight_ids: string[]; warnings: string[] }>;
};

const norm = (n: string | null | undefined) => (n ?? "").toUpperCase().replace(/\s+/g, "").replace(/^0+/, "");
const up = (s: string | null | undefined) => (s ?? "").toUpperCase().trim();

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function loadProcessed(supabase: SupabaseClient, key: string): Promise<Set<string>> {
  const { data } = await supabase.from("sync_state").select("value").is("user_id", null).eq("key", key).limit(1);
  const row = data?.[0] as { value: string } | undefined;
  if (!row) return new Set();
  try {
    return new Set(JSON.parse(row.value) as string[]);
  } catch {
    return new Set();
  }
}

async function saveProcessed(supabase: SupabaseClient, key: string, ids: Set<string>) {
  const value = JSON.stringify([...ids]);
  const { data } = await supabase.from("sync_state").select("id").is("user_id", null).eq("key", key).limit(1);
  const row = data?.[0] as { id: string } | undefined;
  if (row) {
    await supabase.from("sync_state").update({ value }).eq("id", row.id);
  } else {
    await supabase.from("sync_state").insert({ user_id: null, key, value });
  }
}

export async function backfillByFlight(
  supabase: SupabaseClient,
  config: BackfillByFlightConfig,
): Promise<BackfillByFlightResult> {
  const limit = config.limit ?? 12;
  const monthsBefore = config.monthsBefore ?? 12;

  const { data: flightsData, error } = await supabase
    .from("flights")
    .select("id, flight_date, airline_iata, flight_number, dep_iata, arr_iata, booking_id")
    .eq("user_id", config.userId);
  if (error) throw new Error(`Failed to load flights: ${error.message}`);
  const flights = (flightsData ?? []) as KnownFlight[];

  // index flights by date+route so an email leg can be matched without trusting its number
  const byRoute = new Map<string, KnownFlight[]>();
  const queries = new Set<string>();
  let minDate = "9999-99-99";
  let maxDate = "0000-00-00";
  for (const f of flights) {
    const k = `${f.flight_date}|${f.dep_iata}|${f.arr_iata}`;
    const arr = byRoute.get(k) ?? [];
    if (!byRoute.has(k)) byRoute.set(k, arr);
    arr.push(f);
    queries.add(`"${f.airline_iata}${f.flight_number}" OR "${f.airline_iata} ${f.flight_number}"`);
    if (f.flight_date < minDate) minDate = f.flight_date;
    if (f.flight_date > maxDate) maxDate = f.flight_date;
  }
  if (flights.length === 0) {
    return { flights: 0, candidates: 0, processed_now: 0, remaining: 0, bookings_linked: 0, flights_with_booking: 0, discrepancies: [], unmatched_legs: [], results: [] };
  }

  const after = shiftDate(minDate, -monthsBefore * 30);
  const before = shiftDate(maxDate, 8);

  const token = await refreshGmailAccessToken(config.gmailClientId, config.gmailClientSecret, config.gmailRefreshToken);

  // collect candidate message ids (cheap; bodies fetched only for the batch below)
  const candidateIds = new Set<string>();
  for (const clause of queries) {
    const q = `(${clause}) after:${after} before:${before} -category:promotions`;
    for (const id of await listMessageIdsBySearch(token, q)) candidateIds.add(id);
  }

  const key = PROCESSED_KEY(config.userId);
  const processed = await loadProcessed(supabase, key);
  const pending = [...candidateIds].filter((id) => !processed.has(id));
  const batch = pending.slice(0, limit);
  const messages = batch.length ? await fetchMessages(token, batch) : [];

  const discrepancies: string[] = [];
  const unmatched: string[] = [];
  const results: BackfillByFlightResult["results"] = [];
  let linkedCount = 0;

  for (const msg of messages) {
    const warnings: string[] = [];
    let outcome = "skipped";
    const flightIds: string[] = [];
    try {
      const parsed = await parseEmailForFlights(config.geminiApiKey, msg, config.owner);
      processed.add(msg.id); // we paid for the parse — never re-parse this message
      if (parsed.is_cancellation === true) {
        outcome = "cancellation_skipped";
      } else if (!parsed.is_flight_booking || parsed.flights.length === 0) {
        outcome = "not_booking";
      } else if (parsed.owner_is_traveler === false) {
        outcome = "not_traveler";
      } else {
        const matched: KnownFlight[] = [];
        for (const leg of parsed.flights) {
          const cands = byRoute.get(`${leg.flight_date}|${up(leg.dep_iata)}|${up(leg.arr_iata)}`) ?? [];
          const f = cands.length === 1
            ? cands[0]
            : cands.find((c) => norm(c.flight_number) === norm(leg.flight_number)) ??
              cands.find((c) => c.airline_iata === up(leg.airline_iata));
          if (!f) {
            unmatched.push(`${leg.flight_date} ${up(leg.airline_iata)}${leg.flight_number} ${up(leg.dep_iata)}-${up(leg.arr_iata)}`);
            continue;
          }
          if (norm(f.flight_number) !== norm(leg.flight_number) || f.airline_iata !== up(leg.airline_iata)) {
            discrepancies.push(
              `${f.flight_date} ${f.dep_iata}-${f.arr_iata}: log has ${f.airline_iata}${f.flight_number}, email says ${up(leg.airline_iata)}${leg.flight_number} — "${msg.subject}"`,
            );
          }
          if (!matched.find((m) => m.id === f.id)) matched.push(f);
        }

        if (matched.length === 0) {
          outcome = "no_match";
        } else if (!hasBookingContent(parsed)) {
          outcome = "no_booking_content";
        } else {
          const bookingId = await upsertBookingIfPresent(supabase, buildBookingInput(parsed, config.userId, msg), config.userId);
          if (bookingId) {
            for (const f of matched) {
              if (!f.booking_id) {
                if (await linkBooking(supabase, f.id, bookingId, warnings)) {
                  f.booking_id = bookingId;
                  flightIds.push(f.id);
                  linkedCount += 1;
                }
              }
            }
            await recomputeBookingSegmentCost(supabase, bookingId);
            outcome = flightIds.length ? "linked" : "already_linked";
          } else {
            outcome = "no_booking_content";
          }
        }
      }
    } catch (e) {
      outcome = "failed";
      warnings.push(e instanceof Error ? e.message : String(e));
    }
    results.push({ message_id: msg.id, subject: msg.subject, outcome, flight_ids: flightIds, warnings });
  }

  await saveProcessed(supabase, key, processed);

  return {
    flights: flights.length,
    candidates: candidateIds.size,
    processed_now: messages.length,
    remaining: pending.length - batch.length,
    bookings_linked: linkedCount,
    flights_with_booking: flights.filter((f) => f.booking_id).length,
    discrepancies,
    unmatched_legs: [...new Set(unmatched)],
    results,
  };
}
