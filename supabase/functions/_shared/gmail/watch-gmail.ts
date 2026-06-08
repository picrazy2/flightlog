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
    // Set false to suppress the summary email.
    notify?: boolean;
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

  // Oldest first so a booking is processed before its later schedule-change /
  // cancellation email (which needs the flight to already exist).
  const unprocessed = messages
    .filter((m) => !processedIds.has(m.id))
    .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));

  const parseFn = dependencies.parseEmail ??
    ((email) => defaultParseEmail(config.geminiApiKey, email, config.owner));

  const results: WatchGmailMessageResult[] = [];
  for (const message of unprocessed) {
    const result = await processMessage(supabase, message, parseFn, userId);
    results.push(result);
    // Stop immediately if Gemini is rate-limited / over its spending cap —
    // continuing would just fail every remaining message for no reason.
    if (
      result.outcome === "failed" &&
      /quota|spending cap|resource_exhausted|\b429\b/i.test(result.error ?? "")
    ) {
      break;
    }
  }

  // Only mark successfully-handled messages as processed. Failed ones (e.g. a
  // transient Gemini 429 / quota cap) stay unprocessed so a later run retries
  // them instead of permanently skipping a real flight.
  const handledIds = results
    .filter((r) => r.outcome !== "failed")
    .map((r) => r.message_id);
  const newProcessedIds = new Set([...processedIds, ...handledIds]);
  await saveSyncState(supabase, userId, newHistoryId, newProcessedIds);

  const result: WatchGmailResult = {
    messages_scanned: messages.length,
    imported: results.filter((r) => r.outcome === "imported").length,
    updated: results.filter((r) => r.outcome === "updated").length,
    cancelled: results.filter((r) => r.outcome === "cancelled").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    not_flight: results.filter((r) => r.outcome === "not_flight").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    results,
  };

  // Notify on any add/change. Real runs only (accessToken present); never let a
  // notification failure break the import.
  if (
    accessToken && config.owner?.email && config.notify !== false &&
    (result.imported > 0 || result.updated > 0 || result.cancelled > 0)
  ) {
    try {
      await sendRunNotification(
        supabase,
        accessToken,
        config.owner.email,
        result,
        describeWindow(config),
      );
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
  scanWindow: string,
) {
  const ids = result.results
    .filter((r) =>
      r.outcome === "imported" || r.outcome === "updated" ||
      r.outcome === "cancelled"
    )
    .flatMap((r) => r.flight_ids);
  if (ids.length === 0) return;

  // The view carries denormalized class + cost so one query has everything.
  const { data } = await supabase
    .from("v_flights_with_airports")
    .select(
      "id, booking_id, flight_date, airline_iata, flight_number, dep_iata, arr_iata, status, " +
        "cabin_class, aircraft_type_name, cost_cash, cost_currency, cost_points, points_program",
    )
    .in("id", ids);
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  // Pull the booking rows to add PNR, platform, and a link to the source email
  // so each line can be sanity-checked against Gmail.
  const bookingIds = [...new Set(rows.map((r) => r.booking_id).filter(Boolean))];
  const bookingById = new Map<string, Record<string, unknown>>();
  if (bookingIds.length) {
    const { data: bks } = await supabase
      .from("bookings")
      .select("id, booking_refs_airline, booking_ref_platform, raw_email")
      .in("id", bookingIds as string[]);
    for (const b of (bks ?? []) as Array<Record<string, unknown>>) {
      bookingById.set(String(b.id), b);
    }
  }

  const lines = rows
    .sort((a, b) =>
      String(a.flight_date).localeCompare(String(b.flight_date))
    )
    .map((f) => {
      const head =
        `  ${f.flight_date}  ${f.airline_iata}${f.flight_number}  ` +
        `${f.dep_iata} → ${f.arr_iata}`;
      const b = f.booking_id ? bookingById.get(String(f.booking_id)) : undefined;
      const refs = (b?.booking_refs_airline ?? []) as Array<{ pnr?: string }>;
      const pnr = refs.map((x) => x?.pnr).filter(Boolean).join(",") ||
        (b?.booking_ref_platform as string | undefined) || "";
      const mid = (b?.raw_email as { message_id?: string } | undefined)?.message_id;
      const link = mid ? `https://mail.google.com/mail/u/0/#all/${mid}` : "";
      if (f.status === "cancelled") {
        return `${head}  (CANCELLED)${pnr ? `  PNR ${pnr}` : ""}${link ? `\n      ↳ ${link}` : ""}`;
      }
      const extras = [
        f.cabin_class ? formatCabin(String(f.cabin_class)) : null,
        f.aircraft_type_name ? String(f.aircraft_type_name) : null,
        formatCost(f),
        pnr ? `PNR ${pnr}` : null,
      ].filter(Boolean);
      const detail = extras.length ? `${head}  (${extras.join(", ")})` : head;
      return link ? `${detail}\n      ↳ verify: ${link}` : detail;
    });

  const parts: string[] = [];
  if (result.imported > 0) parts.push(`${result.imported} added`);
  if (result.updated > 0) parts.push(`${result.updated} updated`);
  if (result.cancelled > 0) parts.push(`${result.cancelled} cancelled`);
  const summary = parts.join(", ");

  const subject = `✈️ Journia: ${summary} from your inbox`;
  const body = [
    `Journia processed your inbox and made changes:`,
    ``,
    ...lines,
    ``,
    `Imported: ${result.imported}  Updated: ${result.updated}  ` +
    `Cancelled: ${result.cancelled}  Skipped: ${result.skipped}  ` +
    `Not a flight: ${result.not_flight}`,
    ``,
    `Scanned emails: ${scanWindow}`,
  ].join("\n");

  await sendEmail(accessToken, to, subject, body);
}

function describeWindow(config: {
  after?: string;
  before?: string;
  lookbackDays?: number | null;
}): string {
  if (config.after || config.before) {
    return `${config.after ?? "beginning"} to ${config.before ?? "now"}`;
  }
  if (config.lookbackDays === null) return "entire inbox";
  return `last ${config.lookbackDays ?? 7} days`;
}

function formatCabin(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatCost(f: Record<string, unknown>): string | null {
  if (f.cost_cash != null) {
    return `${f.cost_cash} ${f.cost_currency ?? ""}`.trim();
  }
  if (f.cost_points != null) {
    return `${f.cost_points} ${f.points_program ?? "pts"}`.trim();
  }
  return null;
}

async function processMessage(
  supabase: SupabaseClient,
  message: GmailMessage,
  parseFn: (email: GmailMessage) => Promise<GeminiParsedBookingEmail>,
  userId: string | null,
): Promise<WatchGmailMessageResult> {
  try {
    const parsed = await parseFn(message);

    // Cancellation/refund first — these aren't "bookings" so they'd otherwise be
    // dropped by the not_flight gate before we could cancel anything. Mark
    // matching existing flights cancelled; never create. Handled even when the
    // email carries no flight legs: terse "your reservation X was canceled"
    // refunds carry only the confirmation number, which we match on by PNR.
    if (parsed.is_cancellation === true) {
      return await processCancellation(supabase, message, parsed, userId);
    }

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
    // Dedupe legs within a single email: Gemini occasionally emits the same
    // segment twice when a city has two airport codes (e.g. Shanghai PVG vs
    // SHA), creating a phantom duplicate flight. Same airline+number+date is the
    // same flight regardless of which code it used.
    const seenLegKeys = new Set<string>();
    for (const parsedFlight of parsed.flights) {
      const legKey = `${(parsedFlight.airline_iata ?? "").toUpperCase()}|` +
        `${normalizeFlightNumberLoose(parsedFlight.flight_number, parsedFlight.airline_iata ?? "")}|` +
        `${(parsedFlight.flight_date ?? "").trim()}`;
      if (seenLegKeys.has(legKey)) {
        warnings.push(`Skipped duplicate leg within email: ${parsedFlight.airline_iata}${parsedFlight.flight_number} ${parsedFlight.flight_date}`);
        continue;
      }
      seenLegKeys.add(legKey);
      try {
        // Gemini sometimes returns an ICAO airline code (e.g. EZY instead of
        // U2); resolve it to IATA so the flight isn't rejected.
        parsedFlight.airline_iata = await resolveAirlineIata(
          supabase,
          parsedFlight.airline_iata,
        );
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

async function processCancellation(
  supabase: SupabaseClient,
  message: GmailMessage,
  parsed: GeminiParsedBookingEmail,
  userId: string | null,
): Promise<WatchGmailMessageResult> {
  const warnings: string[] = [];
  const cancelledIds: string[] = [];

  for (const f of parsed.flights ?? []) {
    const date = (f.flight_date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      warnings.push(
        `Cancellation leg missing date: ${f.airline_iata}${f.flight_number}`,
      );
      continue;
    }
    const airline = (f.airline_iata ?? "").toUpperCase();
    const flightNumber = normalizeFlightNumberLoose(f.flight_number, airline);
    const hasFlightNumber = /^[A-Z0-9]{1,8}$/.test(flightNumber) &&
      !/^(null|n\/?a|unknown|tbd|tba)$/i.test(flightNumber);
    const dep = (f.dep_iata ?? "").toUpperCase();
    const arr = (f.arr_iata ?? "").toUpperCase();

    // Match by airline + flight number + date — the exact, unambiguous key.
    // Refund/cancellation emails frequently give only the city ("Chengdu"),
    // not the airport code, so the airport pair can't be trusted; the flight
    // number already implies the route. Fall back to date+route only when the
    // refund has no usable flight number.
    let query = supabase.from("flights").select("id, status").eq("flight_date", date);
    if (/^[A-Z0-9]{2}$/.test(airline) && hasFlightNumber) {
      query = query.eq("airline_iata", airline).eq("flight_number", flightNumber);
    } else if (dep.length === 3 && arr.length === 3) {
      query = query.eq("dep_iata", dep).eq("arr_iata", arr);
      if (/^[A-Z0-9]{2}$/.test(airline)) query = query.eq("airline_iata", airline);
    } else {
      warnings.push(
        `Cancellation leg lacks flight number and route: ${airline}${f.flight_number}`,
      );
      continue;
    }
    const { data, error } = await (userId === null
      ? query.is("user_id", null)
      : query.eq("user_id", userId));
    if (error) {
      warnings.push(`Cancellation lookup failed: ${error.message}`);
      continue;
    }

    const matches = ((data ?? []) as Array<{ id: string; status: string }>)
      .filter((r) => r.status !== "cancelled");
    for (const m of matches) {
      const { error: updateError } = await supabase
        .from("flights")
        .update({ status: "cancelled" })
        .eq("id", m.id);
      if (updateError) {
        warnings.push(`Failed to cancel ${m.id}: ${updateError.message}`);
      } else {
        cancelledIds.push(m.id);
      }
    }
  }

  // PNR fallback. Two common cases that the per-leg matching above misses:
  //  1. Terse refunds ("Your reservation X was canceled") carry no flight legs.
  //  2. Change-then-cancel: the cancel email lists the *latest* itinerary, but
  //     the stored flights are an earlier, superseded version of the same PNR —
  //     so flight number / route / date no longer line up.
  // In both, the confirmation code is the only stable key. Cancel every flight
  // belonging to a booking with that PNR, but only when per-leg matching found
  // nothing (keeps precise matches authoritative and avoids over-cancelling).
  if (cancelledIds.length === 0) {
    const pnrs = new Set<string>();
    const refs = (parsed.booking_refs_airline ?? []) as Array<{ pnr?: string }>;
    for (const r of refs) {
      const p = (r?.pnr ?? "").toUpperCase().trim();
      if (/^[A-Z0-9]{5,7}$/.test(p)) pnrs.add(p);
    }
    const plat = (parsed.booking_ref_platform ?? "").toUpperCase().trim();
    if (/^[A-Z0-9]{5,7}$/.test(plat)) pnrs.add(plat);

    for (const pnr of pnrs) {
      const { data: bookings, error: bErr } = await supabase
        .from("bookings")
        .select("id")
        .contains("booking_refs_airline", [{ pnr }]);
      if (bErr) {
        warnings.push(`Booking lookup by PNR ${pnr} failed: ${bErr.message}`);
        continue;
      }
      const bookingIds = ((bookings ?? []) as Array<{ id: string }>).map((b) => b.id);
      if (bookingIds.length === 0) continue;

      let q = supabase.from("flights").select("id, status").in("booking_id", bookingIds);
      q = userId === null ? q.is("user_id", null) : q.eq("user_id", userId);
      const { data, error } = await q;
      if (error) {
        warnings.push(`Cancellation by PNR ${pnr} lookup failed: ${error.message}`);
        continue;
      }
      const matches = ((data ?? []) as Array<{ id: string; status: string }>)
        .filter((r) => r.status !== "cancelled");
      for (const m of matches) {
        const { error: updateError } = await supabase
          .from("flights")
          .update({ status: "cancelled" })
          .eq("id", m.id);
        if (updateError) {
          warnings.push(`Failed to cancel ${m.id} (PNR ${pnr}): ${updateError.message}`);
        } else {
          cancelledIds.push(m.id);
        }
      }
    }
  }

  return {
    message_id: message.id,
    outcome: cancelledIds.length > 0 ? "cancelled" : "skipped",
    flight_ids: cancelledIds,
    warnings,
  };
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

// Gemini occasionally returns a 3-letter ICAO airline code; map it to the
// 2-char IATA code via the airlines table so normalization doesn't reject it.
async function resolveAirlineIata(
  supabase: SupabaseClient,
  code: string | null | undefined,
): Promise<string> {
  const c = (code ?? "").toUpperCase().trim();
  if (/^[A-Z0-9]{2}$/.test(c)) return c;
  if (/^[A-Z]{3}$/.test(c)) {
    const { data } = await supabase
      .from("airlines")
      .select("iata")
      .eq("icao", c)
      .limit(1);
    const iata = (data as Array<{ iata: string }> | null)?.[0]?.iata;
    if (iata) return iata;
  }
  return c;
}

// Strip airline prefix and leading zeros to match how flight_number is stored.
function normalizeFlightNumberLoose(
  value: string | null | undefined,
  airline: string,
): string {
  let n = (value ?? "").toUpperCase().replace(/\s/g, "");
  if (airline && n.startsWith(airline)) n = n.slice(airline.length);
  return n.replace(/^0+(?=\d)/, "");
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
