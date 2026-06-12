// Display names for the snake_case program / platform ids stored on bookings, so the UI
// never shows raw ids. Extend these maps as new ones appear; unknown ids fall back to a
// prettified version (underscores → spaces, title-cased).

export const PROGRAM_NAMES: Record<string, string> = {
  aa_aadvantage: "AAdvantage",
  ac_aeroplan: "Aeroplan",
  air_china_phoenix_miles: "Phoenix Miles",
  alaska_mileage_plan: "Mileage Plan",
  avianca_lifemiles: "LifeMiles",
  ba_avios: "Avios",
  chase_ur: "Chase Ultimate Rewards",
  delta_skymiles: "SkyMiles",
  flying_blue: "Flying Blue",
  singapore_krisflyer: "KrisFlyer",
  united_mileageplus: "MileagePlus",
  virgin_flying_club: "Flying Club",
};

export const PLATFORM_NAMES: Record<string, string> = {
  "booking.com": "Booking.com",
  chase_travel: "Chase Travel",
  ctrip: "Ctrip",
  direct: "Direct",
  expedia: "Expedia",
  flying_blue: "Flying Blue",
  homsom: "Homsom",
  lifemiles: "LifeMiles",
  manual: "Manual",
  orbitz: "Orbitz",
  priceline: "Priceline",
  tongcheng_travel: "Tongcheng Travel",
  "trip.com": "Trip.com",
};

// Known id → pretty name; an unknown (newly-added) id just shows as the id itself.
export const programLabel = (id?: string | null): string => (id ? PROGRAM_NAMES[id] ?? id : "");
export const platformLabel = (id?: string | null): string => (id ? PLATFORM_NAMES[id] ?? id : "");

export const PROGRAM_IDS = Object.keys(PROGRAM_NAMES);
export const PLATFORM_IDS = Object.keys(PLATFORM_NAMES);
