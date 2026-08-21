const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-2.5-flash";

export type GeminiParsedFlight = {
  airline_iata: string;
  flight_number: string;
  flight_date: string;
  dep_iata: string;
  arr_iata: string;
  dep_time_local: string;
  arr_time_local: string;
  cabin_class: string | null;
  // On a schedule change that renumbered the flight, the PRIOR flight number (suffix
  // only) when the email shows both old and new; else null.
  previous_flight_number?: string | null;
};

export type GeminiOwner = {
  name?: string | null;
  email?: string | null;
};

export type GeminiParsedBookingEmail = {
  is_flight_booking: boolean;
  // True when this email is an airline schedule/itinerary CHANGE for an existing
  // trip (new times), as opposed to an original booking, e-ticket, or boarding pass.
  is_schedule_change?: boolean;
  // True when this email is a cancellation/refund for a previously booked flight.
  is_cancellation?: boolean;
  // True when the account owner is a traveler on this flight. Undefined when no
  // owner is configured (the caller then does not gate on it).
  owner_is_traveler?: boolean;
  traveler_names?: string[] | null;
  flights: GeminiParsedFlight[];
  booking_refs_airline: Array<{ airline_iata: string; pnr: string }> | null;
  booking_ref_platform: string | null;
  booking_platform: string | null;
  cost_cash: number | null;
  cost_currency: string | null;
  cost_points: number | null;
  points_program: string | null;
};

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["is_flight_booking", "flights"],
  properties: {
    is_flight_booking: { type: "boolean" },
    is_schedule_change: { type: "boolean", nullable: true },
    is_cancellation: { type: "boolean", nullable: true },
    owner_is_traveler: { type: "boolean", nullable: true },
    traveler_names: {
      type: "array",
      nullable: true,
      items: { type: "string" },
    },
    flights: {
      type: "array",
      items: {
        type: "object",
        required: [
          "airline_iata",
          "flight_number",
          "flight_date",
          "dep_iata",
          "arr_iata",
          "dep_time_local",
          "arr_time_local",
        ],
        properties: {
          airline_iata: { type: "string" },
          flight_number: { type: "string" },
          flight_date: { type: "string", description: "YYYY-MM-DD" },
          dep_iata: { type: "string" },
          arr_iata: { type: "string" },
          dep_time_local: { type: "string", description: "HH:MM (24-hour)" },
          arr_time_local: { type: "string", description: "HH:MM (24-hour)" },
          cabin_class: { type: "string", nullable: true },
          previous_flight_number: { type: "string", nullable: true },
        },
      },
    },
    booking_refs_airline: {
      type: "array",
      nullable: true,
      items: {
        type: "object",
        properties: {
          airline_iata: { type: "string" },
          pnr: { type: "string" },
        },
      },
    },
    booking_ref_platform: { type: "string", nullable: true },
    booking_platform: { type: "string", nullable: true },
    cost_cash: { type: "number", nullable: true },
    cost_currency: { type: "string", nullable: true },
    cost_points: { type: "integer", nullable: true },
    points_program: { type: "string", nullable: true },
  },
};

const SYSTEM_PROMPT =
  `You are a flight email parser. Extract flight information from emails that document a specific flight the recipient is taking.

What counts (set is_flight_booking = true):
- Flight booking confirmations, e-tickets, and itineraries
- Boarding passes and check-in confirmations (these often have no cost — that is fine)
- Multi-language emails (Chinese, French, etc.) — parse them the same way
Only set is_flight_booking = true when the email contains specific flight details (airline, flight number, route, date). It is fine if cost/PNR are missing (common for boarding passes).

Set is_schedule_change = true if the email is an airline schedule/itinerary CHANGE notification for an existing trip (revised times, "your flight time has changed", "confirmation of changes"), as opposed to an original booking, e-ticket, or boarding pass. Use the email's NEW times for the flight fields.

Set is_cancellation = true if the email means a previously booked flight is no longer happening — a ticket refund, cancelled flight, or cancelled booking. This holds REGARDLESS of the refund amount: a cancelled ticket may refund only a small sum if the fare was mostly non-refundable, so a "Ticket Refund" for a flight is still a cancellation even if the amount is tiny. Only set is_cancellation = false for refunds of ancillary add-ons (seat selection, baggage, meal, insurance) where the flight itself still operates. When is_cancellation = true, ALSO set is_flight_booking = true and still extract the affected flight(s) (route + date, plus flight number if shown) so they can be matched to an existing record. ALWAYS extract the confirmation/reservation code into booking_refs_airline (pnr; use the airline shown, else best guess from the sender) even when the email lists NO flight legs — terse refunds like "Your reservation ABC123 was canceled" carry only this code, and it is the key used to find and cancel the original booking.

What does NOT count (set is_flight_booking = false, empty arrays/null elsewhere):
- Hotel/car-rental/train/event reservations, marketing, price alerts, fare sales
- Pre-flight nudges with no concrete flight details, account/login notices

Field rules:
- Extract EVERY individual flight segment as its own flight. A connection/layover is MULTIPLE flights, not one. For example "London (STN) → Almaty (ALA), 1 connecting flight: TK1244 via IST, then TK352" is TWO flights — STN→IST (TK1244) and IST→ALA (TK352). Never collapse a connection into a single origin→destination flight, and never keep only the first or last leg. A round trip with one stopover each way is FOUR flights. List every flight number shown.
- airline_iata: 2-character IATA airline code (e.g. UA, BA, AA)
- flight_number: numeric/alphanumeric suffix only, no airline prefix (e.g. "117" not "BA117")
- flight_date: YYYY-MM-DD, the local operating date at departure
- dep_iata / arr_iata: 3-character IATA airport codes
- dep_time_local / arr_time_local: HH:MM 24-hour local time at the departure/arrival airport
- cabin_class: "economy", "premium_economy", "lie_flat_business", "recliner_first", "international_first", or null
- previous_flight_number: ONLY on a schedule change where the airline assigned a NEW flight number — the PRIOR flight number (numeric/alphanumeric suffix only, no airline prefix) if the email shows both the old and new numbers (e.g. "flight HU7215 is now CN7215", "原 HO1860 → 现 HO1870" → "7215" / "1860"); otherwise null.
- booking_refs_airline: each item has airline_iata (2-char) and pnr (airline confirmation code)
- booking_platform: "direct", "expedia", "google_flights", "chase_travel", or lowercase platform name, or null
- cost_cash: numeric amount (no currency symbol), or null. PER PERSON for the account owner only: if the booking covers multiple passengers and only a combined total is shown, divide by the passenger count. Prefer an explicit "per person" / "total per passenger" figure when present. (e.g. a 4-passenger eTicket Total of 23,903.60 USD → cost_cash = 5975.90.)
- cost_currency: ISO 4217 3-letter code e.g. USD, GBP, or null
- cost_points: integer points/miles REDEEMED to pay for this ticket (an award/points booking), or null. Also PER PERSON (divide a multi-passenger total by passenger count). CRITICAL: only the points spent to BUY the ticket count. Do NOT use miles EARNED/accrued on a paid ticket, "bonus miles", frequent-flyer accrual tables, or upgrade certificates (e.g. United PlusPoints) — those are not the ticket's cost; leave cost_points null and use cost_cash for paid tickets.
- points_program: e.g. "chase_ur", "amex_mr", "united_mp", or null
- traveler_names: the passenger name(s) on the booking, as written, or null if not stated

Do NOT guess:
- Resolve every flight date against the email's received date (given below). The flight year is almost always the same as, or shortly after, the received date — never default to January 1 or a prior year.
- If you cannot confidently determine a flight's date, flight number, or airports from the email body OR its PDF attachments, OMIT that flight. Never invent or place-hold a flight number (no "NULL"/"N/A"), date, or airport.
- If no flight can be confidently extracted, set is_flight_booking = false.
- The attachments (when present) — PDFs or screenshots of an itinerary/boarding pass — are the most authoritative source for flight numbers, times, dates, and cabin class; prefer them over the email body.`;

const OWNER_PROMPT = (owner: GeminiOwner) =>
  `\n\nThe account owner is "${owner.name ?? ""}"${
    owner.email ? ` (${owner.email})` : ""
  }. Set owner_is_traveler = true ONLY if you can positively confirm the owner is one of the travelers/passengers on this flight, matching by name (allowing minor spelling, ordering, or transliteration differences, e.g. "GUO/ALEXANDER", "Alexander K Guo"). Set it false if the booking is for other people, OR if the passenger names are not stated anywhere in the email or its attachments. Do not assume the owner is a traveler just because the email was sent to them — people book flights for others.`;

export async function parseEmailForFlights(
  geminiApiKey: string,
  email: {
    subject: string;
    from: string;
    body: string;
    date?: string;
    attachments?: Array<{ filename: string; mimeType?: string; data: string }>;
  },
  owner?: GeminiOwner,
): Promise<GeminiParsedBookingEmail> {
  const systemPrompt = owner?.name
    ? SYSTEM_PROMPT + OWNER_PROMPT(owner)
    : SYSTEM_PROMPT;
  const prompt =
    `Email received on: ${email.date ?? "unknown"}\nSubject: ${email.subject}\n` +
    `From: ${email.from}\n\n${email.body}`;

  // deno-lint-ignore no-explicit-any
  const parts: any[] = [{ text: prompt }];
  for (const att of email.attachments ?? []) {
    // A forwarded booking is as often a screenshot as a PDF; Gemini reads either, but
    // only if it is told which one it is being handed.
    parts.push({
      inlineData: { mimeType: att.mimeType ?? "application/pdf", data: att.data },
    });
  }

  const res = await fetch(
    `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  return JSON.parse(text) as GeminiParsedBookingEmail;
}
