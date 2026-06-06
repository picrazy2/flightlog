export type FlightStatus = "scheduled" | "completed" | "cancelled";
export type FlightSource =
  | "manual"
  | "aeroapi"
  | "fr24api"
  | "csv_import"
  | "gmail";
export type TrackSource = "fr24api" | "aeroapi";
export type EnrichmentMode = "none" | "try_now";
export type ImportCsvDuplicateMode = "skip" | "update_missing" | "overwrite";
export type ImportCsvEnrichmentMode = "none" | "refresh_after_import";
export type CabinClass =
  | "economy"
  | "premium_economy"
  | "lie_flat_business"
  | "recliner_first"
  | "international_first";

export type BookingInput = {
  id?: string;
  user_id?: string | null;
  booking_refs_airline?: unknown;
  booking_ref_platform?: string | null;
  booking_platform?: string | null;
  cost_cash?: number | string | null;
  cost_currency?: string | null;
  cost_points?: number | null;
  points_program?: string | null;
  raw_email?: unknown;
};

export type FlightInput = {
  user_id?: string | null;
  flight_date?: string;
  airline_iata?: string;
  flight_number?: string;
  dep_iata?: string;
  arr_iata?: string;
  sched_dep?: string;
  sched_arr?: string;
  provider_sched_dep?: string | null;
  provider_sched_arr?: string | null;
  actual_dep?: string | null;
  actual_takeoff?: string | null;
  actual_landing?: string | null;
  actual_arr?: string | null;
  aircraft_type_code?: string | null;
  registration?: string | null;
  cabin_class?: string | null;
  status?: string | null;
  source?: string | null;
  raw_provider?: unknown;
};

export type TrackInput = {
  geojson?: unknown;
  source?: string | null;
  recorded_at?: string;
};

export type CreateFlightRequest = FlightInput & {
  flight?: FlightInput;
  track?: TrackInput | null;
  booking?: BookingInput | null;
  enrichment_mode?: string | null;
};

export type UpdateFlightRequest = FlightInput & {
  id?: string;
  booking?: BookingInput | null;
};

export type CreateLikeFlightRequest = FlightInput;

export type EnrichFlightRequest = {
  flight_date?: string;
  airline_iata?: string | null;
  flight_number?: string;
  dep_iata?: string | null;
  arr_iata?: string | null;
  source_hint?: string | null;
};

export type EnrichFlightResult = {
  found: boolean;
  provider: FlightSource | null;
  flight: FlightInput | null;
  track: TrackInput | null;
  warnings: string[];
};

export type RefreshRecentRequest = {
  flight_id?: string;
  limit?: number;
};

export type ImportCsvRequest = {
  csv_text?: string;
  duplicate_mode?: string | null;
  enrichment_mode?: string | null;
  user_id?: string | null;
};

export type ImportCsvRowResult = {
  row_number: number;
  outcome: "created" | "updated" | "skipped" | "failed";
  flight_id: string | null;
  warnings: string[];
  refresh_outcome?: RefreshRecentFlightResult["outcome"];
  refresh_provider?: FlightSource | null;
  error?: string;
};

export type ImportCsvResult = {
  rows_total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  refreshed: number;
  results: ImportCsvRowResult[];
};

export type WatchGmailRequest = {
  user_id?: string | null;
  // Days back to scan; null = whole inbox (backfill). Omit for the default.
  lookback_days?: number | null;
};

export type WatchGmailMessageResult = {
  message_id: string;
  outcome: "imported" | "updated" | "skipped" | "not_flight" | "failed";
  flight_ids: string[];
  warnings: string[];
  error?: string;
};

export type WatchGmailResult = {
  messages_scanned: number;
  imported: number;
  updated: number;
  skipped: number;
  not_flight: number;
  failed: number;
  results: WatchGmailMessageResult[];
};

export type RefreshRecentCandidate = StoredFlightRow & {
  has_track: boolean;
  track_source: TrackSource | null;
  track_recorded_at: string | null;
};

export type RefreshRecentFlightResult = {
  flight_id: string;
  outcome: "refreshed" | "not_found" | "skipped" | "failed";
  provider: FlightSource | null;
  warnings: string[];
  error?: string;
};

export type RefreshRecentResult = {
  scanned: number;
  eligible: number;
  refreshed: number;
  not_found: number;
  skipped: number;
  failed: number;
  results: RefreshRecentFlightResult[];
};

export type AirportRow = {
  iata: string;
  latitude: number;
  longitude: number;
};

export type AirlineRow = {
  iata: string;
};

export type AircraftTypeRow = {
  code: string;
};

export type AircraftRow = {
  registration: string;
  aircraft_type_code: string | null;
  year_manufactured: number | null;
  country_of_registration: string | null;
  operator_iata: string | null;
  source: "aerodatabox" | "opensky";
  fetched_at: string;
};

export type StoredFlightRow = {
  id: string;
  user_id: string | null;
  flight_date: string;
  airline_iata: string;
  flight_number: string;
  dep_iata: string;
  arr_iata: string;
  sched_dep: string;
  sched_arr: string;
  provider_sched_dep: string | null;
  provider_sched_arr: string | null;
  actual_dep: string | null;
  actual_takeoff: string | null;
  actual_landing: string | null;
  actual_arr: string | null;
  aircraft_type_code: string | null;
  registration: string | null;
  cabin_class: CabinClass | null;
  distance_mi: number | null;
  booking_id: string | null;
  status: FlightStatus;
  source: FlightSource;
  raw_provider: unknown;
};

export type StoredTrackRow = {
  id: string;
  flight_id: string;
  geojson: unknown;
  source: TrackSource;
  recorded_at: string;
  updated_at: string;
};

export type NormalizedFlightInput = {
  user_id: string | null;
  flight_date: string;
  airline_iata: string;
  flight_number: string;
  dep_iata: string;
  arr_iata: string;
  sched_dep: string;
  sched_arr: string;
  provider_sched_dep: string | null;
  provider_sched_arr: string | null;
  actual_dep: string | null;
  actual_takeoff: string | null;
  actual_landing: string | null;
  actual_arr: string | null;
  aircraft_type_code: string | null;
  registration: string | null;
  cabin_class: CabinClass | null;
  status: FlightStatus;
  source: FlightSource;
  raw_provider: unknown;
};

export type NormalizedTrackInput = {
  geojson: Record<string, unknown>;
  source: TrackSource;
  recorded_at: string;
};

export const FLIGHT_STATUS_VALUES = new Set<FlightStatus>([
  "scheduled",
  "completed",
  "cancelled",
]);
export const FLIGHT_SOURCE_VALUES = new Set<FlightSource>([
  "manual",
  "aeroapi",
  "fr24api",
  "csv_import",
  "gmail",
]);
export const TRACK_SOURCE_VALUES = new Set<TrackSource>([
  "fr24api",
  "aeroapi",
]);
export const ENRICHMENT_MODE_VALUES = new Set<EnrichmentMode>([
  "none",
  "try_now",
]);
export const IMPORT_CSV_DUPLICATE_MODE_VALUES = new Set<ImportCsvDuplicateMode>([
  "skip",
  "update_missing",
  "overwrite",
]);
export const IMPORT_CSV_ENRICHMENT_MODE_VALUES = new Set<ImportCsvEnrichmentMode>([
  "none",
  "refresh_after_import",
]);
export const CABIN_CLASS_VALUES = new Set<CabinClass>([
  "economy",
  "premium_economy",
  "lie_flat_business",
  "recliner_first",
  "international_first",
]);
