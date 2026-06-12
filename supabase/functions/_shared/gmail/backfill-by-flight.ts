import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { upsertBookingIfPresent } from "../flights/bookings.ts";
import { recomputeBookingSegmentCost } from "../flights/segment-cost.ts";
import { fetchMessages, refreshGmailAccessToken } from "./gmail-client.ts";
import { parseEmailForFlights } from "./gemini-parser.ts";
import type { GeminiOwner } from "./gemini-parser.ts";
import { buildBookingInput, hasBookingContent, linkBooking } from "./watch-gmail.ts";

// Flight-anchored booking backfill: the already-imported flights are the source of
// truth. The caller discovers candidate message IDs (Gmail searches for each flight's
// number) and passes a SMALL batch here per call — keeping the function light enough to
// stay inside the edge-function resource limit. We Gemini-parse each message and attach
// the booking (cost/points/PNR) only to flights whose date+route the email matches. We
// never create flights and never rewrite a stored flight number — a mismatch is recorded
// as a discrepancy note. Cancellations are skipped (Pass 1).

type KnownFlight = {
  id: string;
  flight_date: string;
  airline_iata: string;
  flight_number: string;
  dep_iata: string;
  arr_iata: string;
  booking_id: string | null;
  cabin_class: string | null;
};

export type BackfillByFlightConfig = {
  userId: string;
  gmailClientId: string;
  gmailClientSecret: string;
  gmailRefreshToken: string;
  geminiApiKey: string;
  owner?: GeminiOwner;
  messageIds: string[]; // the batch of candidate messages to process this call
};

export type BackfillByFlightResult = {
  flights: number;
  processed: number;
  bookings_linked: number;
  cabins_set: number;
  flights_with_booking: number;
  discrepancies: string[];
  unmatched_legs: string[];
  results: Array<{ message_id: string; subject: string; outcome: string; flight_ids: string[]; warnings: string[] }>;
};

const norm = (n: string | null | undefined) => (n ?? "").toUpperCase().replace(/\s+/g, "").replace(/^0+/, "");
const up = (s: string | null | undefined) => (s ?? "").toUpperCase().trim();

export async function backfillByFlight(
  supabase: SupabaseClient,
  config: BackfillByFlightConfig,
): Promise<BackfillByFlightResult> {
  const { data: flightsData, error } = await supabase
    .from("flights")
    .select("id, flight_date, airline_iata, flight_number, dep_iata, arr_iata, booking_id, cabin_class")
    .eq("user_id", config.userId);
  if (error) throw new Error(`Failed to load flights: ${error.message}`);
  const flights = (flightsData ?? []) as KnownFlight[];

  // index flights by date+route so an email leg matches without trusting its number
  const byRoute = new Map<string, KnownFlight[]>();
  for (const f of flights) {
    const k = `${f.flight_date}|${f.dep_iata}|${f.arr_iata}`;
    const arr = byRoute.get(k) ?? [];
    if (!byRoute.has(k)) byRoute.set(k, arr);
    arr.push(f);
  }

  const discrepancies: string[] = [];
  const unmatched: string[] = [];
  const results: BackfillByFlightResult["results"] = [];
  let linkedCount = 0;
  let cabinsSet = 0;

  if (config.messageIds.length === 0) {
    return { flights: flights.length, processed: 0, bookings_linked: 0, cabins_set: 0, flights_with_booking: flights.filter((f) => f.booking_id).length, discrepancies, unmatched_legs: unmatched, results };
  }

  const token = await refreshGmailAccessToken(config.gmailClientId, config.gmailClientSecret, config.gmailRefreshToken);
  const messages = await fetchMessages(token, config.messageIds);

  for (const msg of messages) {
    const warnings: string[] = [];
    let outcome = "skipped";
    const flightIds: string[] = [];
    try {
      const parsed = await parseEmailForFlights(config.geminiApiKey, msg, config.owner);
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
          // Backfill cabin class from the email when the flight has none (CSV imports
          // have no cabin). Keep an existing cabin (import is truth); note a conflict.
          if (leg.cabin_class) {
            if (!f.cabin_class) {
              const { error: ce } = await supabase.from("flights").update({ cabin_class: leg.cabin_class }).eq("id", f.id);
              if (!ce) {
                f.cabin_class = leg.cabin_class;
                cabinsSet += 1;
              }
            } else if (f.cabin_class !== leg.cabin_class) {
              discrepancies.push(`${f.flight_date} ${f.dep_iata}-${f.arr_iata}: cabin log=${f.cabin_class} email=${leg.cabin_class}`);
            }
          }
          if (!matched.find((m) => m.id === f.id)) matched.push(f);
        }

        const needsBooking = matched.filter((f) => !f.booking_id);
        if (matched.length === 0) {
          outcome = "no_match";
        } else if (!hasBookingContent(parsed)) {
          outcome = "no_booking_content";
        } else if (needsBooking.length === 0) {
          // every matched flight already has a booking — don't create an orphan
          outcome = "already_linked";
        } else {
          const bookingId = await upsertBookingIfPresent(supabase, buildBookingInput(parsed, config.userId, msg), config.userId);
          if (bookingId) {
            for (const f of needsBooking) {
              if (await linkBooking(supabase, f.id, bookingId, warnings)) {
                f.booking_id = bookingId;
                flightIds.push(f.id);
                linkedCount += 1;
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

  return {
    flights: flights.length,
    processed: messages.length,
    bookings_linked: linkedCount,
    cabins_set: cabinsSet,
    flights_with_booking: flights.filter((f) => f.booking_id).length,
    discrepancies,
    unmatched_legs: [...new Set(unmatched)],
    results,
  };
}
