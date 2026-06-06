import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { DateTime } from "npm:luxon@3.7.2";

import { upsertBookingIfPresent } from "../flights/bookings.ts";
import { HttpError } from "../flights/http.ts";
import { normalizeFlightInput } from "../flights/normalize.ts";
import { createFlight } from "../flights/service.ts";
import type {
  BookingInput,
  FlightInput,
  NormalizedFlightInput,
  WatchGmailMessageResult,
  WatchGmailResult,
} from "../flights/types.ts";
import type { GmailMessage, GmailScanResult } from "./gmail-client.ts";
import {
  refreshGmailAccessToken,
  scanNewMessages as defaultScanMessages,
  sendEmail,
} from "./gmail-client.ts";
import type {
  GeminiOwner,
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
    owner?: GeminiOwner;
    // Days back to search; null = whole inbox (backfill). Default in gmail-client.
    lookbackDays?: number | null;
    // Explicit window (YYYY/MM/DD) for chunked backfills; overrides lookbackDays.
    after?: string;
    before?: string;
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
    ((token, historyId) =>
      defaultScanMessages(token, historyId, {
        lookbackDays: config.lookbackDays,
        after: config.after,
        before: config.before,
      }));

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
    ((email) => defaultParseEmail(config.geminiApiKey, email, config.owner));

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

  const result: WatchGmailResult = {
    messages_scanned: messages.length,
    imported: results.filter((r) => r.outcome === "imported").length,
    updated: results.filter((r) => r.outcome === "updated").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    not_flight: results.filter((r) => r.outcome === "not_flight").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    results,
  };

  // Notify on any add/change. Real runs only (accessToken present); never let a
  // notification failure break the import.
  if (
    accessToken && config.owner?.email &&
    (result.imported > 0 || result.updated > 0)
  ) {
    try {
      await sendRunNotification(supabase, accessToken, config.owner.email, result);
    } catch (error) {
      result.results.push({
        message_id: "notification",
        outcome: "failed",
        flight_ids: [],
        warnings: [],
        error: `Notification email failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  return result;
}

async function sendRunNotification(
  supabase: SupabaseClient,
  accessToken: string,
  to: string,
  result: WatchGmailResult,
) {
  const ids = result.results
    .filter((r) => r.outcome === "imported" || r.outcome === "updated")
    .flatMap((r) => r.flight_ids);
  if (ids.length === 0) return;

  const { data } = await supabase
    .from("flights")
    .select("flight_date, airline_iata, flight_number, dep_iata, arr_iata, booking_id")
    .in("id", ids);
  const rows = (data ?? []) as Array<{
    flight_date: string;
    airline_iata: string;
    flight_number: string;
    dep_iata: string;
    arr_iata: string;
    booking_id: string | null;
  }>;

  const lines = rows
    .sort((a, b) => a.flight_date.localeCompare(b.flight_date))
    .map((f) =>
      `  ${f.flight_date}  ${f.airline_iata}${f.flight_number}  ${f.dep_iata} → ${f.arr_iata}`
    );

  const parts: string[] = [];
  if (result.imported > 0) parts.push(`${result.imported} added`);
  if (result.updated > 0) parts.push(`${result.updated} updated`);
  const summary = parts.join(", ");

  const subject = `✈️ Flightlog: ${summary} from your inbox`;
  const body = [
    `Flightlog processed your inbox and made changes:`,
    ``,
    ...lines,
    ``,
    `Imported: ${result.imported}  Updated: ${result.updated}  ` +
    `Skipped: ${result.skipped}  Not a flight: ${result.not_flight}`,
  ].join("\n");

  await sendEmail(accessToken, to, subject, body);
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

    // Passenger gate: drop bookings where the account owner isn't a traveler.
    // owner_is_traveler is only set when an owner is configured.
    if (parsed.owner_is_traveler === false) {
      return {
        message_id: message.id,
        outcome: "not_flight",
        flight_ids: [],
        warnings: ["Account owner is not a traveler on this booking"],
      };
    }

    const allIatas = parsed.flights.flatMap((f) => [
      f.dep_iata.toUpperCase(),
      f.arr_iata.toUpperCase(),
    ]);
    const airports = await loadAirportTimezones(supabase, allIatas);

    const warnings: string[] = [];

    // First pass: normalize each leg and look up any existing flight.
    type LegPlan = {
      input: FlightInput;
      normalized: NormalizedFlightInput;
      existing: ExistingFlight | null;
    };
    const plans: LegPlan[] = [];
    for (const parsedFlight of parsed.flights) {
      try {
        const input = buildFlightInput(parsedFlight, airports, userId);
        const normalized = normalizeFlightInput(input);
        const existing = await findExistingFlight(supabase, normalized, userId);
        plans.push({ input, normalized, existing });
      } catch (error) {
        warnings.push(
          `${parsedFlight.airline_iata}${parsedFlight.flight_number}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const newLegs = plans.filter((p) => !p.existing);
    const existingLegs = plans.filter((p) => p.existing);
    const existingBookingIds = [
      ...new Set(
        existingLegs
          .filter((p) => p.existing!.booking_id)
          .map((p) => p.existing!.booking_id as string),
      ),
    ];
    const existingLegsNeedingBooking = existingLegs.filter(
      (p) => !p.existing!.booking_id,
    );

    // Resolve a booking id: reuse the trip's existing booking when there's
    // exactly one; otherwise create a fresh one from this email's payload, but
    // only if a new flight needs it (or an existing flight has none yet).
    const bookingInput = buildBookingInput(parsed, userId, message.id);
    const wantsBooking =
      (newLegs.length > 0 || existingLegsNeedingBooking.length > 0) &&
      hasBookingContent(parsed);
    const createdFreshBooking = existingBookingIds.length !== 1 && wantsBooking;
    const bookingId = existingBookingIds.length === 1
      ? existingBookingIds[0]
      : createdFreshBooking
      ? await upsertBookingIfPresent(supabase, bookingInput, userId)
      : null;
    let bookingUsed = existingBookingIds.length === 1;

    // Create genuinely new flights.
    const createdIds: string[] = [];
    for (const plan of newLegs) {
      try {
        const { flight, warnings: flightWarnings } = await createFlight(
          supabase,
          { ...plan.input, enrichment_mode: "try_now" },
        );
        const flightId = String(flight.id);
        createdIds.push(flightId);
        warnings.push(...flightWarnings);
        if (bookingId && await linkBooking(supabase, flightId, bookingId, warnings)) {
          bookingUsed = true;
        }
      } catch (error) {
        warnings.push(
          `${plan.input.airline_iata}${plan.input.flight_number}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Update existing flights. Schedule (sched_dep/arr) is the booking's source
    // of truth, so an ordinary booking/boarding-pass does NOT overwrite it —
    // only an explicit schedule-change does. A booking is backfilled onto an
    // existing flight that has none yet (e.g. boarding pass arrived first).
    const updatedIds: string[] = [];
    for (const plan of existingLegs) {
      const ex = plan.existing!;
      const changes: Record<string, unknown> = {};
      if (
        parsed.is_schedule_change === true &&
        (instantsDiffer(plan.normalized.sched_dep, ex.sched_dep) ||
          instantsDiffer(plan.normalized.sched_arr, ex.sched_arr))
      ) {
        changes.sched_dep = plan.normalized.sched_dep;
        changes.sched_arr = plan.normalized.sched_arr;
      }
      if (!ex.booking_id && bookingId) {
        changes.booking_id = bookingId;
        bookingUsed = true;
      }
      if (Object.keys(changes).length === 0) continue;

      const { error } = await supabase
        .from("flights")
        .update(changes)
        .eq("id", ex.id);
      if (error) {
        warnings.push(`Failed to update flight ${ex.id}: ${error.message}`);
      } else {
        updatedIds.push(ex.id);
      }
    }

    // Don't leave a freshly-created booking unattached.
    if (createdFreshBooking && bookingId && !bookingUsed) {
      await supabase.from("bookings").delete().eq("id", bookingId);
    }

    if (createdIds.length > 0) {
      return {
        message_id: message.id,
        outcome: "imported",
        flight_ids: createdIds,
        warnings,
      };
    }
    if (updatedIds.length > 0) {
      return {
        message_id: message.id,
        outcome: "updated",
        flight_ids: updatedIds,
        warnings,
      };
    }
    if (newLegs.length > 0) {
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
      outcome: "skipped",
      flight_ids: existingLegs.map((p) => p.existing!.id),
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
  const flightNumber = (parsed.flight_number ?? "").trim();
  if (!flightNumber || /^(null|n\/?a|unknown|tbd|tba)$/i.test(flightNumber)) {
    throw new Error(`Missing or invalid flight number: "${parsed.flight_number}"`);
  }

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

// Real booking content worth a bookings row — excludes raw_email provenance,
// which is always present. A boarding pass with no cost/PNR should not create one.
function hasBookingContent(parsed: GeminiParsedBookingEmail): boolean {
  return Boolean(
    parsed.cost_cash != null ||
      parsed.cost_points != null ||
      parsed.cost_currency ||
      parsed.points_program ||
      parsed.booking_platform ||
      parsed.booking_ref_platform ||
      (parsed.booking_refs_airline && parsed.booking_refs_airline.length > 0),
  );
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

type ExistingFlight = {
  id: string;
  booking_id: string | null;
  sched_dep: string;
  sched_arr: string;
};

async function findExistingFlight(
  supabase: SupabaseClient,
  flight: NormalizedFlightInput,
  userId: string | null,
): Promise<ExistingFlight | null> {
  const query = supabase
    .from("flights")
    .select("id, booking_id, sched_dep, sched_arr")
    .eq("flight_date", flight.flight_date)
    .eq("airline_iata", flight.airline_iata)
    .eq("flight_number", flight.flight_number)
    .eq("dep_iata", flight.dep_iata)
    .eq("arr_iata", flight.arr_iata);
  const { data, error } = await (userId === null
    ? query.is("user_id", null)
    : query.eq("user_id", userId));

  if (error) {
    throw new HttpError(500, `Failed to check existing flight: ${error.message}`);
  }

  const rows = (data ?? []) as ExistingFlight[];
  return rows[0] ?? null;
}

function instantsDiffer(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a !== b;
  return Math.abs(ta - tb) > 60_000; // ignore sub-minute jitter
}

async function linkBooking(
  supabase: SupabaseClient,
  flightId: string,
  bookingId: string,
  warnings: string[],
): Promise<boolean> {
  const { error } = await supabase
    .from("flights")
    .update({ booking_id: bookingId })
    .eq("id", flightId);
  if (error) {
    warnings.push(`Failed to link booking: ${error.message}`);
    return false;
  }
  return true;
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
