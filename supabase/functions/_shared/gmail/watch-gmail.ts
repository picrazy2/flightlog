import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { DateTime } from "npm:luxon@3.7.2";

import { upsertBookingIfPresent } from "../flights/bookings.ts";
import { HttpError } from "../flights/http.ts";
import { hasBookingPayload } from "../flights/normalize.ts";
import { createFlight } from "../flights/service.ts";
import type {
  BookingInput,
  FlightInput,
  WatchGmailMessageResult,
  WatchGmailResult,
} from "../flights/types.ts";
import type { GmailMessage, GmailScanResult } from "./gmail-client.ts";
import {
  refreshGmailAccessToken,
  scanNewMessages as defaultScanMessages,
} from "./gmail-client.ts";
import type {
  GeminiParsedBookingEmail,
  GeminiParsedFlight,
} from "./gemini-parser.ts";
import { parseEmailForFlights as defaultParseEmail } from "./gemini-parser.ts";

const HISTORY_ID_KEY = "gmail_last_history_id";
const PROCESSED_IDS_KEY = "gmail_processed_ids";
const MAX_PROCESSED_IDS = 1000;

export async function watchGmail(
  supabase: SupabaseClient,
  config: {
    gmailClientId: string;
    gmailClientSecret: string;
    gmailRefreshToken: string;
    geminiApiKey: string;
    userId?: string | null;
  },
  dependencies: {
    scanMessages?: (
      accessToken: string,
      lastHistoryId: string | null,
    ) => Promise<GmailScanResult>;
    parseEmail?: (email: GmailMessage) => Promise<GeminiParsedBookingEmail>;
  } = {},
): Promise<WatchGmailResult> {
  const userId = config.userId ?? null;
  const { lastHistoryId, processedIds } = await loadSyncState(supabase, userId);

  const scanFn = dependencies.scanMessages ??
    ((token, historyId) => defaultScanMessages(token, historyId));

  // Skip token refresh when scanMessages is injected (e.g. in tests)
  const accessToken = dependencies.scanMessages
    ? ""
    : await refreshGmailAccessToken(
        config.gmailClientId,
        config.gmailClientSecret,
        config.gmailRefreshToken,
      );
  const { messages, historyId: newHistoryId } = await scanFn(
    accessToken,
    lastHistoryId,
  );

  const unprocessed = messages.filter((m) => !processedIds.has(m.id));

  const parseFn = dependencies.parseEmail ??
    ((email) => defaultParseEmail(config.geminiApiKey, email));

  const results: WatchGmailMessageResult[] = [];
  for (const message of unprocessed) {
    const result = await processMessage(supabase, message, parseFn, userId);
    results.push(result);
  }

  const newProcessedIds = new Set([
    ...processedIds,
    ...unprocessed.map((m) => m.id),
  ]);
  await saveSyncState(supabase, userId, newHistoryId, newProcessedIds);

  return {
    messages_scanned: messages.length,
    imported: results.filter((r) => r.outcome === "imported").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    not_flight: results.filter((r) => r.outcome === "not_flight").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    results,
  };
}

async function processMessage(
  supabase: SupabaseClient,
  message: GmailMessage,
  parseFn: (email: GmailMessage) => Promise<GeminiParsedBookingEmail>,
  userId: string | null,
): Promise<WatchGmailMessageResult> {
  try {
    const parsed = await parseFn(message);

    if (!parsed.is_flight_booking || parsed.flights.length === 0) {
      return {
        message_id: message.id,
        outcome: "not_flight",
        flight_ids: [],
        warnings: [],
      };
    }

    const allIatas = parsed.flights.flatMap((f) => [
      f.dep_iata.toUpperCase(),
      f.arr_iata.toUpperCase(),
    ]);
    const airports = await loadAirportTimezones(supabase, allIatas);

    const bookingInput = buildBookingInput(parsed, userId, message.id);
    // Create the booking once so all legs can share it
    const bookingId = hasBookingPayload(bookingInput)
      ? await upsertBookingIfPresent(supabase, bookingInput, userId)
      : null;

    const flightIds: string[] = [];
    const warnings: string[] = [];

    for (const parsedFlight of parsed.flights) {
      try {
        const flightInput = buildFlightInput(parsedFlight, airports, userId);
        const { flight, warnings: flightWarnings } = await createFlight(
          supabase,
          { ...flightInput, enrichment_mode: "try_now" },
        );
        const flightId = String(flight.id);
        flightIds.push(flightId);
        warnings.push(...flightWarnings);

        if (bookingId) {
          const { error } = await supabase
            .from("flights")
            .update({ booking_id: bookingId })
            .eq("id", flightId);
          if (error) {
            warnings.push(`Failed to link booking: ${error.message}`);
          }
        }
      } catch (error) {
        warnings.push(
          `${parsedFlight.airline_iata}${parsedFlight.flight_number}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (flightIds.length === 0) {
      return {
        message_id: message.id,
        outcome: "failed",
        flight_ids: [],
        warnings,
        error: "All flights failed to create",
      };
    }

    return {
      message_id: message.id,
      outcome: "imported",
      flight_ids: flightIds,
      warnings,
    };
  } catch (error) {
    return {
      message_id: message.id,
      outcome: "failed",
      flight_ids: [],
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildFlightInput(
  parsed: GeminiParsedFlight,
  airports: Map<string, { iata: string; timezone: string }>,
  userId: string | null,
): FlightInput {
  const depIata = parsed.dep_iata.toUpperCase();
  const arrIata = parsed.arr_iata.toUpperCase();
  const depAirport = airports.get(depIata);
  const arrAirport = airports.get(arrIata);

  if (!depAirport) throw new Error(`Unknown departure airport: ${depIata}`);
  if (!arrAirport) throw new Error(`Unknown arrival airport: ${arrIata}`);

  const schedDep = parseLocalToUtc(
    parsed.flight_date,
    parsed.dep_time_local,
    depAirport.timezone,
  );
  const schedArr = parseArrivalToUtc(
    parsed.flight_date,
    parsed.arr_time_local,
    arrAirport.timezone,
    schedDep,
  );

  return {
    user_id: userId,
    flight_date: parsed.flight_date,
    airline_iata: parsed.airline_iata.toUpperCase(),
    flight_number: parsed.flight_number,
    dep_iata: depIata,
    arr_iata: arrIata,
    sched_dep: schedDep,
    sched_arr: schedArr,
    cabin_class: parsed.cabin_class,
    source: "gmail",
  };
}

function buildBookingInput(
  parsed: GeminiParsedBookingEmail,
  userId: string | null,
  messageId: string,
): BookingInput {
  return {
    user_id: userId,
    booking_refs_airline: parsed.booking_refs_airline ?? undefined,
    booking_ref_platform: parsed.booking_ref_platform ?? undefined,
    booking_platform: parsed.booking_platform ?? undefined,
    cost_cash: parsed.cost_cash ?? undefined,
    cost_currency: parsed.cost_currency ?? undefined,
    cost_points: parsed.cost_points ?? undefined,
    points_program: parsed.points_program ?? undefined,
    raw_email: { message_id: messageId },
  };
}

function parseLocalToUtc(date: string, time: string, timezone: string): string {
  const dt = DateTime.fromISO(`${date}T${normalizeTime(time)}`, {
    zone: timezone,
  });
  if (!dt.isValid) {
    throw new Error(
      `Invalid time ${time} on ${date} (${timezone}): ${dt.invalidReason}`,
    );
  }
  return toUtcIso(dt);
}

function parseArrivalToUtc(
  flightDate: string,
  time: string,
  timezone: string,
  departureUtc: string,
): string {
  const depDt = DateTime.fromISO(departureUtc, { zone: "utc" });
  const normalized = normalizeTime(time);

  const candidates = [0, 1, 2]
    .map((offset) =>
      DateTime.fromISO(`${flightDate}T${normalized}`, { zone: timezone }).plus({
        days: offset,
      })
    )
    .filter((dt) => dt.isValid);

  const selected = candidates.find(
    (dt) => dt.toUTC().toMillis() >= depDt.toMillis(),
  ) ?? candidates[0];

  if (!selected) {
    throw new Error(`Invalid arrival time: ${flightDate} ${time} (${timezone})`);
  }

  return toUtcIso(selected);
}

function normalizeTime(time: string): string {
  const [hours = "00", minutes = "00"] = time.split(":");
  return `${hours.padStart(2, "0")}:${minutes}:00`;
}

function toUtcIso(dt: DateTime): string {
  const iso = dt
    .toUTC()
    .toISO({ suppressMilliseconds: true, includeOffset: true });
  if (!iso) throw new Error("Failed to format timestamp");
  return iso.replace(".000Z", "Z");
}

async function loadSyncState(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<{ lastHistoryId: string | null; processedIds: Set<string> }> {
  const query = supabase.from("sync_state").select("key, value");
  const { data, error } = await (userId === null
    ? query.is("user_id", null)
    : query.eq("user_id", userId));

  if (error) {
    throw new HttpError(500, `Failed to load sync state: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ key: string; value: string }>;
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const lastHistoryId = byKey.get(HISTORY_ID_KEY) ?? null;

  let processedIds: Set<string>;
  try {
    const raw = byKey.get(PROCESSED_IDS_KEY);
    processedIds = raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    processedIds = new Set();
  }

  return { lastHistoryId, processedIds };
}

async function saveSyncState(
  supabase: SupabaseClient,
  userId: string | null,
  historyId: string,
  processedIds: Set<string>,
) {
  const cappedIds = [...processedIds].slice(-MAX_PROCESSED_IDS);
  await upsertSyncStateKey(supabase, userId, HISTORY_ID_KEY, historyId);
  await upsertSyncStateKey(
    supabase,
    userId,
    PROCESSED_IDS_KEY,
    JSON.stringify(cappedIds),
  );
}

// SELECT + conditional INSERT/UPDATE avoids a dependency on the expression-based
// unique index (coalesce(user_id, ...), key), which Supabase's upsert can't target directly.
async function upsertSyncStateKey(
  supabase: SupabaseClient,
  userId: string | null,
  key: string,
  value: string,
) {
  const selectQuery = supabase.from("sync_state").select("id").eq("key", key);
  const { data, error: selectError } = await (userId === null
    ? selectQuery.is("user_id", null)
    : selectQuery.eq("user_id", userId));

  if (selectError) {
    throw new HttpError(
      500,
      `Failed to read sync state: ${selectError.message}`,
    );
  }

  const rows = (data ?? []) as Array<{ id: string }>;

  if (rows.length > 0) {
    const updateQuery = supabase
      .from("sync_state")
      .update({ value })
      .eq("key", key);
    const { error } = await (userId === null
      ? updateQuery.is("user_id", null)
      : updateQuery.eq("user_id", userId));
    if (error) {
      throw new HttpError(500, `Failed to update sync state: ${error.message}`);
    }
  } else {
    const { error } = await supabase
      .from("sync_state")
      .insert({ user_id: userId, key, value });
    if (error) {
      throw new HttpError(500, `Failed to insert sync state: ${error.message}`);
    }
  }
}

async function loadAirportTimezones(
  supabase: SupabaseClient,
  iatas: string[],
): Promise<Map<string, { iata: string; timezone: string }>> {
  const unique = [...new Set(iatas)];
  const { data, error } = await supabase
    .from("airports")
    .select("iata, timezone")
    .in("iata", unique);

  if (error) {
    throw new HttpError(500, `Failed to load airports: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as Array<{ iata: string; timezone: string }>).map((a) => [
      a.iata,
      a,
    ]),
  );
}
