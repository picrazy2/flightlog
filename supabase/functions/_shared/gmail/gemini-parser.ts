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

What does NOT count (set is_flight_booking = false, empty arrays/null elsewhere):
- Hotel/car-rental/train/event reservations, marketing, price alerts, fare sales
- Pre-flight nudges with no concrete flight details, account/login notices

Field rules:
- Extract every flight leg, including connections and both directions of a round trip
- airline_iata: 2-character IATA airline code (e.g. UA, BA, AA)
- flight_number: numeric/alphanumeric suffix only, no airline prefix (e.g. "117" not "BA117")
- flight_date: YYYY-MM-DD, the local operating date at departure
- dep_iata / arr_iata: 3-character IATA airport codes
- dep_time_local / arr_time_local: HH:MM 24-hour local time at the departure/arrival airport
- cabin_class: "economy", "premium_economy", "lie_flat_business", "recliner_first", "international_first", or null
- booking_refs_airline: each item has airline_iata (2-char) and pnr (airline confirmation code)
- booking_platform: "direct", "expedia", "google_flights", "chase_travel", or lowercase platform name, or null
- cost_cash: numeric amount (no currency symbol), or null
- cost_currency: ISO 4217 3-letter code e.g. USD, GBP, or null
- cost_points: integer points/miles used, or null
- points_program: e.g. "chase_ur", "amex_mr", "united_mp", or null
- traveler_names: the passenger name(s) on the booking, as written, or null if not stated`;

const OWNER_PROMPT = (owner: GeminiOwner) =>
  `\n\nThe account owner is "${owner.name ?? ""}"${
    owner.email ? ` (${owner.email})` : ""
  }. Set owner_is_traveler = true if the owner is one of the travelers/passengers on this flight, matching by name and allowing for minor spelling, ordering, or transliteration differences (e.g. "GUO/ALEXANDER", "Alexander K Guo"). Set it false if the booking is only for other people. If the travelers cannot be determined at all, set it true.`;

export async function parseEmailForFlights(
  geminiApiKey: string,
  email: { subject: string; from: string; body: string },
  owner?: GeminiOwner,
): Promise<GeminiParsedBookingEmail> {
  const systemPrompt = owner?.name
    ? SYSTEM_PROMPT + OWNER_PROMPT(owner)
    : SYSTEM_PROMPT;
  const prompt = `Subject: ${email.subject}\nFrom: ${email.from}\n\n${email.body}`;

  const res = await fetch(
    `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
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
