import { processMessage, watchGmail } from "./watch-gmail.ts";
import {
  assert,
  assertEquals,
  createMockSupabaseClient,
} from "../flights/test-helpers.ts";
import type { GeminiParsedBookingEmail } from "./gemini-parser.ts";
import type { GmailMessage } from "./gmail-client.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const AIRPORTS = [
  { iata: "LHR", latitude: 51.47, longitude: -0.4543, timezone: "Europe/London" },
  { iata: "JFK", latitude: 40.6413, longitude: -73.7781, timezone: "America/New_York" },
  { iata: "LAX", latitude: 33.9425, longitude: -118.408, timezone: "America/Los_Angeles" },
];

const AIRLINES = [
  { iata: "BA", name: "British Airways" },
  { iata: "AA", name: "American Airlines" },
];

const MOCK_CONFIG = {
  gmailClientId: "client-id",
  gmailClientSecret: "client-secret",
  gmailRefreshToken: "refresh-token",
  geminiApiKey: "gemini-key",
  userId: USER_ID,
};

function mockScanMessages(
  messages: GmailMessage[],
  historyId: string,
) {
  return async (_token: string, _historyId: string | null) => ({
    messages,
    historyId,
  });
}

function mockParseEmail(result: GeminiParsedBookingEmail) {
  return async (_email: GmailMessage) => result;
}

const NOT_FLIGHT: GeminiParsedBookingEmail = {
  is_flight_booking: false,
  flights: [],
  booking_refs_airline: null,
  booking_ref_platform: null,
  booking_platform: null,
  cost_cash: null,
  cost_currency: null,
  cost_points: null,
  points_program: null,
};

Deno.test("watchGmail imports a single-leg booking email", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "msg1", subject: "BA booking", from: "ba@ba.com", date: "Mon, 1 Jun 2026", body: "" }],
      "100",
    ),
    parseEmail: mockParseEmail({
      is_flight_booking: true,
      flights: [
        {
          airline_iata: "BA",
          flight_number: "117",
          flight_date: "2026-07-01",
          dep_iata: "LHR",
          arr_iata: "JFK",
          dep_time_local: "10:00",
          arr_time_local: "13:00",
          cabin_class: "economy",
        },
      ],
      booking_refs_airline: [{ airline_iata: "BA", pnr: "XYZ123" }],
      booking_ref_platform: null,
      booking_platform: "direct",
      cost_cash: 500,
      cost_currency: "GBP",
      cost_points: null,
      points_program: null,
    }),
  });

  assertEquals(result.messages_scanned, 1);
  assertEquals(result.imported, 1);
  assertEquals(result.not_flight, 0);
  assertEquals(result.results[0].outcome, "imported");
  assertEquals(result.results[0].flight_ids.length, 1);
  assertEquals(supabase.db.flights.length, 1);
  assertEquals(supabase.db.flights[0].source, "gmail");
  assertEquals(supabase.db.flights[0].airline_iata, "BA");
  assertEquals(supabase.db.bookings.length, 1);
  assertEquals(supabase.db.bookings[0].cost_cash, 500);
});

Deno.test("watchGmail creates flights for a round-trip booking sharing one booking row", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "msg1", subject: "Round trip", from: "ba@ba.com", date: "Mon, 1 Jun 2026", body: "" }],
      "200",
    ),
    parseEmail: mockParseEmail({
      is_flight_booking: true,
      flights: [
        {
          airline_iata: "BA",
          flight_number: "117",
          flight_date: "2026-07-01",
          dep_iata: "LHR",
          arr_iata: "JFK",
          dep_time_local: "10:00",
          arr_time_local: "13:00",
          cabin_class: null,
        },
        {
          airline_iata: "BA",
          flight_number: "118",
          flight_date: "2026-07-15",
          dep_iata: "JFK",
          arr_iata: "LHR",
          dep_time_local: "19:00",
          arr_time_local: "07:00",
          cabin_class: null,
        },
      ],
      booking_refs_airline: [{ airline_iata: "BA", pnr: "RT456" }],
      booking_ref_platform: null,
      booking_platform: null,
      cost_cash: 1200,
      cost_currency: "USD",
      cost_points: null,
      points_program: null,
    }),
  });

  assertEquals(result.imported, 1);
  assertEquals(supabase.db.flights.length, 2);
  assertEquals(supabase.db.bookings.length, 1);
  // Both legs linked to the same booking
  assertEquals(
    supabase.db.flights[0].booking_id,
    supabase.db.flights[1].booking_id,
  );
});

Deno.test("watchGmail marks non-flight emails as not_flight", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "msg1", subject: "Newsletter", from: "news@airline.com", date: "Mon, 1 Jun 2026", body: "" }],
      "100",
    ),
    parseEmail: mockParseEmail(NOT_FLIGHT),
  });

  assertEquals(result.messages_scanned, 1);
  assertEquals(result.not_flight, 1);
  assertEquals(result.imported, 0);
  assertEquals(supabase.db.flights.length, 0);
});

Deno.test("watchGmail skips already-processed message IDs", async () => {
  const supabase = createMockSupabaseClient({
    airports: AIRPORTS,
    airlines: AIRLINES,
    sync_state: [
      { user_id: USER_ID, key: "gmail_last_history_id", value: "50" },
      {
        user_id: USER_ID,
        key: "gmail_processed_ids",
        value: JSON.stringify(["msg1"]),
      },
    ],
  });

  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "msg1", subject: "BA booking", from: "ba@ba.com", date: "Mon, 1 Jun 2026", body: "" }],
      "100",
    ),
    parseEmail: async () => { throw new Error("should not be called"); },
  });

  assertEquals(result.messages_scanned, 1);
  assertEquals(result.imported, 0);
  assertEquals(result.results.length, 0);
  assertEquals(supabase.db.flights.length, 0);
});

const SINGLE_BA_BOOKING: GeminiParsedBookingEmail = {
  is_flight_booking: true,
  flights: [
    {
      airline_iata: "BA",
      flight_number: "117",
      flight_date: "2026-07-01",
      dep_iata: "LHR",
      arr_iata: "JFK",
      dep_time_local: "10:00",
      arr_time_local: "13:00",
      cabin_class: "economy",
    },
  ],
  booking_refs_airline: [{ airline_iata: "BA", pnr: "XYZ123" }],
  booking_ref_platform: null,
  booking_platform: "direct",
  cost_cash: 500,
  cost_currency: "GBP",
  cost_points: null,
  points_program: null,
};

Deno.test("watchGmail skips a duplicate-flight email without creating an orphan booking", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  // First email creates the flight + booking
  await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "m1", subject: "BA booking", from: "ba@ba.com", date: "x", body: "" }],
      "1",
    ),
    parseEmail: mockParseEmail(SINGLE_BA_BOOKING),
  });
  assertEquals(supabase.db.flights.length, 1);
  assertEquals(supabase.db.bookings.length, 1);

  // A second, different email about the SAME flight (e.g. an airline reminder)
  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "m2", subject: "Fwd: BA booking", from: "me@me.com", date: "x", body: "" }],
      "2",
    ),
    parseEmail: mockParseEmail(SINGLE_BA_BOOKING),
  });

  assertEquals(result.skipped, 1);
  assertEquals(result.imported, 0);
  assertEquals(supabase.db.flights.length, 1); // no duplicate flight
  assertEquals(supabase.db.bookings.length, 1); // no orphan booking
});

Deno.test("watchGmail drops bookings where the owner is not a traveler", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "m1", subject: "Someone else's BA booking", from: "ba@ba.com", date: "x", body: "" }],
      "1",
    ),
    parseEmail: mockParseEmail({ ...SINGLE_BA_BOOKING, owner_is_traveler: false }),
  });

  assertEquals(result.not_flight, 1);
  assertEquals(result.imported, 0);
  assertEquals(supabase.db.flights.length, 0);
  assertEquals(supabase.db.bookings.length, 0);
});

Deno.test("processMessage can waive the passenger gate for a deliberate forward", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });
  const message = { id: "m1", subject: "Fwd: screenshot", from: "a@b.com", date: "x", body: "" };
  const parsed = { ...SINGLE_BA_BOOKING, owner_is_traveler: false };

  // The inbox scan keeps the gate: an email naming other travellers isn't yours.
  const gated = await processMessage(supabase as never, message, () => Promise.resolve(parsed), USER_ID);
  assertEquals(gated.outcome, "not_flight");
  assertEquals(supabase.db.flights.length, 0);

  // ingest-email waives it: a screenshot rarely names its passenger, and forwarding it
  // in is itself the claim of ownership, so the same email must import.
  const forwarded = await processMessage(
    supabase as never,
    { ...message, id: "m2" },
    () => Promise.resolve(parsed),
    USER_ID,
    { requireOwnerIsTraveler: false },
  );
  assertEquals(forwarded.outcome, "imported");
  assertEquals(supabase.db.flights.length, 1);
});

Deno.test("watchGmail cancels an existing flight on a refund/cancellation email", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  // First, import the flight
  await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "m1", subject: "BA booking", from: "ba@ba.com", date: "x", body: "" }],
      "1",
    ),
    parseEmail: mockParseEmail(SINGLE_BA_BOOKING),
  });
  assertEquals(supabase.db.flights[0].status, "scheduled");

  // Then a refund email for the same route/date
  const refund: GeminiParsedBookingEmail = {
    ...SINGLE_BA_BOOKING,
    is_flight_booking: false, // refunds aren't "bookings" — must still cancel
    is_cancellation: true,
    booking_platform: null,
    cost_cash: null,
    cost_currency: null,
    booking_refs_airline: null,
    flights: [{ ...SINGLE_BA_BOOKING.flights[0], flight_number: "NULL" }], // refund omits flight no.
  };
  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "m2", subject: "Ticket Refund: London - New York", from: "ba@ba.com", date: "x", body: "" }],
      "2",
    ),
    parseEmail: mockParseEmail(refund),
  });

  assertEquals(result.cancelled, 1);
  assertEquals(supabase.db.flights.length, 1); // not duplicated
  assertEquals(supabase.db.flights[0].status, "cancelled");
});

Deno.test("watchGmail cancels by PNR when the refund email lists no flights", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "m1", subject: "BA booking", from: "ba@ba.com", date: "x", body: "" }],
      "1",
    ),
    parseEmail: mockParseEmail(SINGLE_BA_BOOKING), // PNR XYZ123
  });
  assertEquals(supabase.db.flights[0].status, "scheduled");

  // Terse refund: only the confirmation code, no flight legs at all.
  const refund: GeminiParsedBookingEmail = {
    ...SINGLE_BA_BOOKING,
    is_flight_booking: false,
    is_cancellation: true,
    booking_platform: null,
    cost_cash: null,
    cost_currency: null,
    booking_refs_airline: [{ airline_iata: "BA", pnr: "XYZ123" }],
    flights: [],
  };
  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "m2", subject: "Your reservation XYZ123 was canceled", from: "ba@ba.com", date: "x", body: "" }],
      "2",
    ),
    parseEmail: mockParseEmail(refund),
  });

  assertEquals(result.cancelled, 1);
  assertEquals(supabase.db.flights.length, 1);
  assertEquals(supabase.db.flights[0].status, "cancelled");
});

Deno.test("watchGmail cancels by PNR when the cancel email lists a rebooked (mismatched) itinerary", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "m1", subject: "BA booking", from: "ba@ba.com", date: "x", body: "" }],
      "1",
    ),
    parseEmail: mockParseEmail(SINGLE_BA_BOOKING), // stored flight, PNR XYZ123
  });
  assertEquals(supabase.db.flights[0].status, "scheduled");

  // Cancel email for the SAME PNR but listing a different (rebooked) flight —
  // per-leg matching can't connect them, PNR fallback must.
  const refund: GeminiParsedBookingEmail = {
    ...SINGLE_BA_BOOKING,
    is_flight_booking: false,
    is_cancellation: true,
    booking_platform: null,
    cost_cash: null,
    cost_currency: null,
    booking_refs_airline: [{ airline_iata: "BA", pnr: "XYZ123" }],
    flights: [{
      ...SINGLE_BA_BOOKING.flights[0],
      flight_number: "999",
      dep_iata: "JFK",
      arr_iata: "LAX",
      flight_date: "2099-01-01",
    }],
  };
  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "m2", subject: "Your reservation has been canceled (XYZ123)", from: "ba@ba.com", date: "x", body: "" }],
      "2",
    ),
    parseEmail: mockParseEmail(refund),
  });

  assertEquals(result.cancelled, 1);
  assertEquals(supabase.db.flights.length, 1);
  assertEquals(supabase.db.flights[0].status, "cancelled");
});

Deno.test("watchGmail rejects a flight with a null/invalid flight number", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "m1", subject: "Booking", from: "x@y.com", date: "x", body: "" }],
      "1",
    ),
    parseEmail: mockParseEmail({
      ...SINGLE_BA_BOOKING,
      flights: [{ ...SINGLE_BA_BOOKING.flights[0], flight_number: "NULL" }],
    }),
  });

  // The only leg is invalid → nothing created, no orphan booking
  assertEquals(result.imported, 0);
  assertEquals(supabase.db.flights.length, 0);
  assertEquals(supabase.db.bookings.length, 0);
});

Deno.test("watchGmail updates an existing flight on a schedule change", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "m1", subject: "BA booking", from: "ba@ba.com", date: "x", body: "" }],
      "1",
    ),
    parseEmail: mockParseEmail(SINGLE_BA_BOOKING),
  });
  const origDep = supabase.db.flights[0].sched_dep;

  const changed: GeminiParsedBookingEmail = {
    ...SINGLE_BA_BOOKING,
    is_schedule_change: true,
    flights: [{
      ...SINGLE_BA_BOOKING.flights[0],
      dep_time_local: "14:00",
      arr_time_local: "17:00",
    }],
  };
  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "m2", subject: "Your flight time has changed", from: "ba@ba.com", date: "x", body: "" }],
      "2",
    ),
    parseEmail: mockParseEmail(changed),
  });

  assertEquals(result.updated, 1);
  assertEquals(result.imported, 0);
  assertEquals(supabase.db.flights.length, 1); // no duplicate
  assert(supabase.db.flights[0].sched_dep !== origDep); // schedule updated
});

Deno.test("watchGmail renumbers a flight in place on a schedule change (no duplicate)", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });
  const BOOKING: GeminiParsedBookingEmail = {
    is_flight_booking: true,
    flights: [{
      airline_iata: "BA", flight_number: "117", flight_date: "2026-07-01",
      dep_iata: "LHR", arr_iata: "JFK", dep_time_local: "10:00", arr_time_local: "13:00", cabin_class: "economy",
    }],
    booking_refs_airline: [{ airline_iata: "BA", pnr: "REN789" }],
    booking_ref_platform: null, booking_platform: "direct",
    cost_cash: 500, cost_currency: "GBP", cost_points: null, points_program: null,
  };
  await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages([{ id: "m1", subject: "BA booking", from: "ba@ba.com", date: "x", body: "" }], "1"),
    parseEmail: mockParseEmail(BOOKING),
  });
  assertEquals(supabase.db.flights.length, 1);
  assertEquals(supabase.db.flights[0].flight_number, "117");

  // airline reissued the leg as BA118 — same PNR + route + date, no previous_flight_number
  // given, so it must reconcile via the booking PNR (not an exact number match).
  const CHANGE: GeminiParsedBookingEmail = {
    ...BOOKING,
    is_schedule_change: true,
    flights: [{ ...BOOKING.flights[0], flight_number: "118" }],
  };
  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages([{ id: "m2", subject: "Flight number changed", from: "ba@ba.com", date: "x", body: "" }], "2"),
    parseEmail: mockParseEmail(CHANGE),
  });
  assertEquals(result.imported, 0); // not created as a new flight
  assertEquals(result.updated, 1); // updated in place
  assertEquals(supabase.db.flights.length, 1); // no duplicate
  assertEquals(supabase.db.flights[0].flight_number, "118"); // renumbered
});

Deno.test("watchGmail creates a flight from a boarding pass with no booking payload", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  const boardingPass: GeminiParsedBookingEmail = {
    is_flight_booking: true,
    flights: [{
      airline_iata: "BA",
      flight_number: "891",
      flight_date: "2026-05-26",
      dep_iata: "LHR",
      arr_iata: "JFK",
      dep_time_local: "09:00",
      arr_time_local: "12:00",
      cabin_class: null,
    }],
    booking_refs_airline: null,
    booking_ref_platform: null,
    booking_platform: null,
    cost_cash: null,
    cost_currency: null,
    cost_points: null,
    points_program: null,
  };

  const result = await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "bp1", subject: "Boarding pass for Mr Alexander Guo", from: "ba@ba.com", date: "x", body: "" }],
      "1",
    ),
    parseEmail: mockParseEmail(boardingPass),
  });

  assertEquals(result.imported, 1);
  assertEquals(supabase.db.flights.length, 1);
  assertEquals(supabase.db.bookings.length, 0); // no booking payload -> no booking
});

Deno.test("watchGmail works with null user_id (cron path)", async () => {
  // The cron invokes with no user_id. Filtering sync_state by a null uuid must use
  // .is(), not .eq() — the mock rejects .eq(col, null) like real PostgREST/Postgres.
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  const result = await watchGmail(supabase as never, { ...MOCK_CONFIG, userId: null }, {
    scanMessages: mockScanMessages(
      [{ id: "msgX", subject: "Newsletter", from: "x@y.com", date: "Mon, 1 Jun 2026", body: "" }],
      "321",
    ),
    parseEmail: mockParseEmail(NOT_FLIGHT),
  });

  assertEquals(result.messages_scanned, 1);
  const historyRow = supabase.db.sync_state.find(
    (r) => (r as Record<string, unknown>)["key"] === "gmail_last_history_id",
  ) as Record<string, unknown> | undefined;
  assertEquals(historyRow?.["value"], "321");
  assertEquals(historyRow?.["user_id"] ?? null, null);
});

Deno.test("watchGmail saves historyId and processed IDs to sync_state", async () => {
  const supabase = createMockSupabaseClient({ airports: AIRPORTS, airlines: AIRLINES });

  await watchGmail(supabase as never, MOCK_CONFIG, {
    scanMessages: mockScanMessages(
      [{ id: "msg42", subject: "Newsletter", from: "x@y.com", date: "Mon, 1 Jun 2026", body: "" }],
      "999",
    ),
    parseEmail: mockParseEmail(NOT_FLIGHT),
  });

  const historyRow = supabase.db.sync_state.find(
    (r) => (r as Record<string, unknown>)["key"] === "gmail_last_history_id",
  ) as Record<string, unknown> | undefined;
  assertEquals(historyRow?.["value"], "999");

  const processedRow = supabase.db.sync_state.find(
    (r) => (r as Record<string, unknown>)["key"] === "gmail_processed_ids",
  ) as Record<string, unknown> | undefined;
  const ids = JSON.parse(processedRow?.["value"] as string) as string[];
  assertEquals(ids.includes("msg42"), true);
});
