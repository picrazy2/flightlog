import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { DateTime } from "npm:luxon@3.7.2";

import { upsertBookingIfPresent } from "../flights/bookings.ts";
import { HttpError } from "../flights/http.ts";
import { normalizeFlightInput } from "../flights/normalize.ts";
import { recomputeBookingSegmentCost } from "../flights/segment-cost.ts";
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
  INGEST_ADDRESS,
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

  // The view carries denormalized airline / airport / aircraft / cost so one query has
  // everything. Selected wide on purpose: the point of this email is to expose exactly
  // what was recorded, so a wrong classification is caught now rather than months later.
  const { data } = await supabase
    .from("v_flights_with_airports")
    .select(
      "id, booking_id, flight_date, airline_iata, flight_number, dep_iata, arr_iata, status, " +
        "cabin_class, aircraft_type_name, cost_cash, cost_currency, cost_points, points_program, " +
        "airline_name, alliance, sched_dep, sched_arr, dep_timezone, arr_timezone, " +
        "dep_name, dep_city, dep_country_name, arr_name, arr_city, arr_country_name, " +
        "distance_mi, aircraft_type_code, aircraft_type_manufacturer, registration, " +
        "cost_cash_usd, booking_platform, trip_type, source, " +
        "terminal_origin, terminal_destination",
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
      .select("id, booking_refs_airline, booking_ref_platform, emails")
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
      const emails = (b?.emails ?? []) as Array<
        { message_id?: string; kind?: string }
      >;
      // Link to the most relevant email: the cancellation for a cancelled leg,
      // otherwise the original booking, falling back to whatever is recorded.
      const preferKind = f.status === "cancelled" ? "cancellation" : "booking";
      const mid = (emails.find((e) => e.kind === preferKind) ??
        emails.find((e) => e.kind === "booking") ?? emails[0])?.message_id;
      const link = mid ? `https://mail.google.com/mail/u/0/#all/${mid}` : "";
      if (f.status === "cancelled") {
        return `${head}  (CANCELLED)${pnr ? `  PNR ${pnr}` : ""}${link ? `\n      ↳ ${link}` : ""}`;
      }

      // Every derived field is shown, including the ones that came back empty, so a
      // silently-missed airline match or a missing fare is visible at a glance rather
      // than looking like it was never part of the booking.
      const field = (label: string, value: unknown) =>
        `      ${label.padEnd(11)} ${value == null || value === "" ? MISSING : value}`;

      const airline = f.airline_name
        ? `${f.airline_name} (${f.airline_iata})${f.alliance ? ` · ${f.alliance}` : ""}`
        : null;
      const aircraft = f.aircraft_type_name
        ? [f.aircraft_type_manufacturer, f.aircraft_type_name].filter(Boolean)
          .join(" ") +
          (f.aircraft_type_code ? ` (${f.aircraft_type_code})` : "") +
          (f.registration ? ` · ${f.registration}` : "")
        : null;
      const from = `${f.dep_iata} ${f.dep_name ?? ""}`.trim() +
        (f.dep_city ? ` — ${f.dep_city}, ${f.dep_country_name ?? ""}`.trimEnd() : "") +
        (f.terminal_origin ? ` · T${f.terminal_origin}` : "");
      const to_ = `${f.arr_iata} ${f.arr_name ?? ""}`.trim() +
        (f.arr_city ? ` — ${f.arr_city}, ${f.arr_country_name ?? ""}`.trimEnd() : "") +
        (f.terminal_destination ? ` · T${f.terminal_destination}` : "");

      return [
        head,
        field("airline", airline),
        field("aircraft", aircraft),
        field("from", from),
        field("to", to_),
        field("departs", formatWhen(f.sched_dep, f.dep_timezone)),
        field("arrives", formatWhen(f.sched_arr, f.arr_timezone)),
        field("distance", f.distance_mi == null ? null : `${Math.round(Number(f.distance_mi))} mi`),
        field("cabin", f.cabin_class ? formatCabin(String(f.cabin_class)) : null),
        field("cost", formatFullCost(f)),
        field("booking", [pnr ? `PNR ${pnr}` : null, f.booking_platform, f.trip_type]
          .filter(Boolean).join(" · ") || null),
        field("source", f.source),
        link ? `      ↳ verify:    ${link}` : null,
      ].filter(Boolean).join("\n");
    });

  const parts: string[] = [];
  if (result.imported > 0) parts.push(`${result.imported} added`);
  if (result.updated > 0) parts.push(`${result.updated} updated`);
  if (result.cancelled > 0) parts.push(`${result.cancelled} cancelled`);
  const summary = parts.join(", ");

  // Roll the per-flight gaps up into one list, so a partial import is actionable
  // rather than only visible to someone reading every block closely.
  const gaps = rows
    .filter((f) => f.status !== "cancelled")
    .map((f) => {
      const missing = [
        f.airline_name ? null : "airline",
        f.aircraft_type_name ? null : "aircraft",
        f.distance_mi == null ? "distance" : null,
        f.cabin_class ? null : "cabin",
        formatFullCost(f) ? null : "cost",
      ].filter(Boolean);
      return missing.length
        ? `  ${f.airline_iata}${f.flight_number} ${f.dep_iata}→${f.arr_iata}: ` +
          `${missing.join(", ")}`
        : null;
    })
    .filter(Boolean) as string[];

  const subject = `✈️ Journia: ${summary} from your inbox`;
  const body = [
    `Journia processed your inbox and made changes.`,
    `Every field recorded is listed below — check it against the source email.`,
    ``,
    lines.join("\n\n"),
    ``,
    ...(gaps.length
      ? [
        `⚠ Did not resolve — worth a look:`,
        ...gaps,
        ``,
      ]
      : []),
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

// Shown in place of an empty field. Deliberately conspicuous: a blank would read as
// "not applicable", but every one of these fields should normally resolve.
const MISSING = "— not set —";

// Cash and points are not exclusive (a points booking still carries cash taxes), so
// this reports both, plus the USD conversion actually stored.
function formatFullCost(f: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (f.cost_cash != null) {
    const usd = f.cost_cash_usd != null && f.cost_currency !== "USD"
      ? ` (≈ ${Number(f.cost_cash_usd).toFixed(2)} USD)`
      : "";
    parts.push(`${f.cost_cash} ${f.cost_currency ?? ""}`.trim() + usd);
  }
  if (f.cost_points != null) {
    parts.push(`${f.cost_points} ${f.points_program ?? "pts"}`.trim());
  }
  return parts.length ? parts.join(" + ") : null;
}

// Scheduled times are stored as timestamptz but only mean anything to a traveller in
// the airport's own local time, so render each end in its own zone and name the zone.
function formatWhen(value: unknown, timezone: unknown): string | null {
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
    // owner_is_traveler is only set when an owner is configured. Mail sent to the ingest
    // address is exempt: forwarding a booking there is itself the claim that it is yours,
    // and a screenshot of an itinerary usually carries no passenger name for Gemini to
    // match against, so the gate would otherwise drop exactly what was asked for.
    const viaIngest = message.to?.toLowerCase().includes(INGEST_ADDRESS.toLowerCase()) ?? false;
    if (parsed.owner_is_traveler === false && !viaIngest) {
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
      prevNum: string | null; // prior flight number from a renumbering schedule change
      renumber: boolean;      // existing matched as a superseded leg → apply the new number
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
        const prevNum = normalizeFlightNumberLoose(parsedFlight.previous_flight_number ?? "", parsedFlight.airline_iata ?? "") || null;
        plans.push({ input, normalized, existing, prevNum, renumber: false });
      } catch (error) {
        warnings.push(
          `${parsedFlight.airline_iata}${parsedFlight.flight_number}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Schedule change that renumbered a flight: a leg with no exact match may be an
    // existing flight whose number changed. Reconcile by the prior number (when the email
    // gives one) or by the booking PNR + same date/route, and update it in place instead
    // of creating a duplicate.
    if (parsed.is_schedule_change === true) {
      const changeBookingIds = await bookingIdsForParsedPnrs(supabase, parsed);
      for (const plan of plans) {
        if (plan.existing) continue;
        let sup: ExistingFlight | null = null;
        if (plan.prevNum && plan.prevNum !== plan.normalized.flight_number) {
          sup = await findExistingFlight(supabase, { ...plan.normalized, flight_number: plan.prevNum }, userId);
        }
        if (!sup && changeBookingIds.length > 0) {
          sup = await findSupersededLeg(supabase, changeBookingIds, plan.normalized, userId);
        }
        if (sup) {
          plan.existing = sup;
          plan.renumber = true;
          warnings.push(`${plan.input.airline_iata}${plan.input.flight_number}: matched a renumbered flight (was ${plan.prevNum ?? "a different number"}) — updated in place`);
        }
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
    const bookingInput = buildBookingInput(parsed, userId, message);
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
    const scheduleChangedBookingIds = new Set<string>();
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
        const bid = ex.booking_id ?? bookingId;
        if (bid) scheduleChangedBookingIds.add(bid);
      }
      if (plan.renumber) {
        changes.flight_number = plan.normalized.flight_number;
        changes.provider_status = null; // re-enrich under the new number on the next refresh
        const bid = ex.booking_id ?? bookingId;
        if (bid) scheduleChangedBookingIds.add(bid);
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

    // Record the schedule-change email on every booking it revised, so the
    // booking carries its full email history (booking → change → cancel).
    if (scheduleChangedBookingIds.size > 0) {
      await appendBookingEmails(
        supabase,
        scheduleChangedBookingIds,
        bookingEmailEntry(message, "schedule_change"),
        warnings,
      );
    }

    // Don't leave a freshly-created booking unattached.
    if (createdFreshBooking && bookingId && !bookingUsed) {
      await supabase.from("bookings").delete().eq("id", bookingId);
    }

    // Split the booking's cost across its legs by great-circle distance. Run
    // after linking so every leg that exists so far is included; re-runs as more
    // legs of the booking arrive in later emails self-correct the split.
    if (bookingId && bookingUsed) {
      await recomputeBookingSegmentCost(supabase, bookingId);
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
  const cancelledBookingIds = new Set<string>();

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
    let query = supabase.from("flights").select("id, status, booking_id").eq(
      "flight_date",
      date,
    );
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

    const matches =
      ((data ?? []) as Array<
        { id: string; status: string; booking_id: string | null }
      >)
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
        if (m.booking_id) cancelledBookingIds.add(m.booking_id);
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
      if (matches.length > 0) {
        for (const id of bookingIds) cancelledBookingIds.add(id);
      }
    }
  }

  // Record the cancellation email on every booking it cancelled.
  if (cancelledBookingIds.size > 0) {
    await appendBookingEmails(
      supabase,
      cancelledBookingIds,
      bookingEmailEntry(message, "cancellation"),
      warnings,
    );
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

// Real booking content worth a bookings row — excludes email provenance,
// which is always present. A boarding pass with no cost/PNR should not create one.
export function hasBookingContent(parsed: GeminiParsedBookingEmail): boolean {
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

export function buildBookingInput(
  parsed: GeminiParsedBookingEmail,
  userId: string | null,
  message: GmailMessage,
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
    emails: [bookingEmailEntry(message, "booking")],
  };
}

// One provenance entry for the bookings.emails array.
type BookingEmailKind = "booking" | "schedule_change" | "cancellation";
export function bookingEmailEntry(message: GmailMessage, kind: BookingEmailKind) {
  return {
    message_id: message.id,
    subject: message.subject,
    from: message.from,
    date: message.date,
    kind,
  };
}

// Append an email provenance entry to each booking, idempotently (a given
// message_id+kind is recorded once). Used when a schedule-change or cancellation
// email touches a booking that already exists.
async function appendBookingEmails(
  supabase: SupabaseClient,
  bookingIds: Iterable<string>,
  entry: ReturnType<typeof bookingEmailEntry>,
  warnings: string[],
): Promise<void> {
  for (const id of new Set([...bookingIds].filter(Boolean))) {
    const { data, error } = await supabase
      .from("bookings")
      .select("emails")
      .eq("id", id)
      .single();
    if (error) {
      warnings.push(`Failed to load emails for booking ${id}: ${error.message}`);
      continue;
    }
    const arr = Array.isArray((data as { emails?: unknown })?.emails)
      ? (data as { emails: Array<Record<string, unknown>> }).emails
      : [];
    if (
      arr.some((e) =>
        e.message_id === entry.message_id && e.kind === entry.kind
      )
    ) {
      continue;
    }
    arr.push(entry);
    const { error: upErr } = await supabase
      .from("bookings")
      .update({ emails: arr })
      .eq("id", id);
    if (upErr) {
      warnings.push(`Failed to append email to booking ${id}: ${upErr.message}`);
    }
  }
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

// Among flights on the given bookings, find one matching this leg's date + route but a
// DIFFERENT flight number (a renumbered/superseded leg). Returns null unless exactly one
// such flight exists, to avoid ambiguous over-matching.
async function findSupersededLeg(
  supabase: SupabaseClient,
  bookingIds: string[],
  flight: NormalizedFlightInput,
  userId: string | null,
): Promise<ExistingFlight | null> {
  const query = supabase
    .from("flights")
    .select("id, booking_id, sched_dep, sched_arr")
    .in("booking_id", bookingIds)
    .eq("flight_date", flight.flight_date)
    .eq("dep_iata", flight.dep_iata)
    .eq("arr_iata", flight.arr_iata)
    .neq("flight_number", flight.flight_number);
  const { data, error } = await (userId === null
    ? query.is("user_id", null)
    : query.eq("user_id", userId));
  if (error) {
    throw new HttpError(500, `Superseded-leg lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as ExistingFlight[];
  return rows.length === 1 ? rows[0] : null;
}

// Existing booking ids whose airline PNRs match those in this email — used to reconcile a
// renumbered schedule-change leg back to its original booking.
async function bookingIdsForParsedPnrs(
  supabase: SupabaseClient,
  parsed: GeminiParsedBookingEmail,
): Promise<string[]> {
  const pnrs = new Set<string>();
  for (const r of (parsed.booking_refs_airline ?? []) as Array<{ pnr?: string }>) {
    const p = (r?.pnr ?? "").toUpperCase().trim();
    if (/^[A-Z0-9]{5,7}$/.test(p)) pnrs.add(p);
  }
  const ids = new Set<string>();
  for (const pnr of pnrs) {
    const { data } = await supabase.from("bookings").select("id").contains("booking_refs_airline", [{ pnr }]);
    for (const b of (data ?? []) as Array<{ id: string }>) ids.add(b.id);
  }
  return [...ids];
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

export async function linkBooking(
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
