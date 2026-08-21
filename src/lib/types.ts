// One row of v_flights_with_airports — the denormalized read surface.
// Mirrors docs/DECISIONS.md "The View" + the segment-cost columns added later.
export type CabinClass =
  | "economy"
  | "premium_economy"
  | "lie_flat_business"
  | "recliner_first"
  | "international_first";

export type FlightStatus = "scheduled" | "completed" | "cancelled";
export type TripType = "domestic" | "international" | null;

export interface BookingEmail {
  message_id: string;
  subject?: string;
  from?: string;
  date?: string;
  kind?: "booking" | "schedule_change" | "cancellation";
}

export interface Flight {
  id: string;
  user_id: string; // owner (e.g. "alex")
  flight_date: string; // YYYY-MM-DD
  airline_iata: string;
  flight_number: string;
  dep_iata: string;
  arr_iata: string;
  sched_dep: string; // ISO (user's booked schedule)
  sched_arr: string;
  provider_sched_dep: string | null; // airline scheduled gate times (correct date/TZ)
  provider_sched_arr: string | null;
  provider_sched_takeoff: string | null; // airline scheduled wheels times
  provider_sched_landing: string | null;
  actual_dep: string | null; // gate out (AeroAPI only)
  actual_arr: string | null; // gate in (AeroAPI only)
  actual_takeoff: string | null; // wheels up — canonical actual departure
  actual_landing: string | null; // wheels down — canonical actual arrival
  aircraft_type_code: string | null;
  registration: string | null;
  cabin_class: CabinClass | null;
  distance_mi: number | null; // great-circle
  route_distance_mi: number | null; // actual filed route distance (AeroAPI)
  flown_distance_mi: number | null; // length of the recorded track incl. GC fillers
  terminal_origin: string | null;
  terminal_destination: string | null;
  gate_origin: string | null;
  gate_destination: string | null;
  actual_runway_off: string | null;
  actual_runway_on: string | null;
  diverted: boolean | null;
  provider_status: string | null;
  status: FlightStatus;
  source: string;
  booking_id: string | null;

  // segment cost (distance-weighted share of the booking)
  cost_cash_segment: number | null;
  cost_points_segment: number | null;
  cost_cash_segment_usd: number | null; // per-leg cash converted to USD at the flight date

  // derived in the view
  trip_type: TripType;

  // airports
  dep_name: string | null;
  dep_city: string | null;
  dep_country: string | null;
  dep_country_name: string | null;
  dep_continent: string | null;
  dep_lat: number | null;
  dep_lng: number | null;
  dep_timezone: string | null;
  arr_name: string | null;
  arr_city: string | null;
  arr_country: string | null;
  arr_country_name: string | null;
  arr_continent: string | null;
  arr_lat: number | null;
  arr_lng: number | null;
  arr_timezone: string | null;

  // airline / aircraft
  airline_name: string | null;
  alliance: string | null;
  airline_logo_treatment: string | null; // "color" | "lighten" | "none" — see AirlineLogo
  aircraft_type_name: string | null;
  aircraft_type_body_class: "narrowbody" | "widebody" | null;
  aircraft_type_deck_count: number | null;

  // booking (cost on the whole booking, not the segment)
  booking_refs_airline: { airline_iata: string; pnr: string }[] | null;
  booking_ref_platform: string | null;
  cost_cash: number | null;
  cost_currency: string | null;
  cost_cash_usd: number | null; // whole-booking cash converted to USD at the booking date
  cost_points: number | null;
  points_program: string | null;
  emails: BookingEmail[] | null;
}

export interface Settings {
  units: "mi" | "km";
  showTracks: boolean; // show actual tracks when available (else great-circle arcs)
  markEstimated: boolean; // dash + thin the estimated (great-circle/filler) line portions
  currency: string; // display currency for cost figures (ISO code, e.g. "USD")
}
