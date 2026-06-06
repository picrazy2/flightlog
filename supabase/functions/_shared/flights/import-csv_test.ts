import { importCsvFlights } from "./import-csv.ts";
import {
  assertEquals,
  assertRejects,
  createMockSupabaseClient,
} from "./test-helpers.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const AIRPORTS = [
  {
    iata: "STN",
    latitude: 51.885,
    longitude: 0.235,
    timezone: "Europe/London",
  },
  {
    iata: "FAO",
    latitude: 37.014,
    longitude: -7.965,
    timezone: "Europe/Lisbon",
  },
  {
    iata: "LGW",
    latitude: 51.1537,
    longitude: -0.1821,
    timezone: "Europe/London",
  },
  {
    iata: "JFK",
    latitude: 40.6413,
    longitude: -73.7781,
    timezone: "America/New_York",
  },
  {
    iata: "LHR",
    latitude: 51.47,
    longitude: -0.4543,
    timezone: "Europe/London",
  },
];

const AIRLINES = [
  { iata: "FR", name: "Ryanair" },
  { iata: "U2", name: "easyJet" },
  { iata: "BA", name: "British Airways" },
];

const AIRCRAFT_TYPES = [
  { code: "B738", name: "Boeing 737-800" },
  { code: "A319", name: "Airbus A319" },
];

Deno.test("importCsvFlights creates flights from the app CSV contract", async () => {
  const supabase = createMockSupabaseClient({
    airports: AIRPORTS,
    airlines: AIRLINES,
    aircraft_types: AIRCRAFT_TYPES,
  });

  const csv = [
    "Date,Scheduled Dep Time (Local),Scheduled Arr Time (Local),Actual Dep Time (Local),Actual Arr Time (Local),Actual Takeoff Time (Local),Actual Landing Time (Local),Airline,Flight,Dep Airport,Arr Airport,Class,Aircraft,Registration",
    "2026-03-05,19:30,22:30,19:29,21:59,19:29:25,21:59:25,Ryanair,FR9142,STN,FAO,Economy,B738,EI-EKY",
    "2026-03-10,19:50,22:35,19:52,22:27,19:52:57,22:27:03,easyJet,U28534,FAO,LGW,,A319,G-EZGR",
  ].join("\n");

  const result = await importCsvFlights(supabase as never, {
    csv_text: csv,
    user_id: USER_ID,
  });

  assertEquals(result.rows_total, 2);
  assertEquals(result.created, 2);
  assertEquals(result.failed, 0);
  assertEquals(supabase.db.flights.length, 2);
  assertEquals(supabase.db.flights[0].source, "csv_import");
  assertEquals(supabase.db.flights[0].cabin_class, "economy");
  assertEquals(
    supabase.db.flights[0].actual_takeoff,
    "2026-03-05T19:29:25.000Z",
  );
  assertEquals(
    supabase.db.flights[0].actual_landing,
    "2026-03-05T21:59:25.000Z",
  );
});

Deno.test("importCsvFlights supports update_missing duplicate mode", async () => {
  const supabase = createMockSupabaseClient({
    airports: AIRPORTS,
    airlines: AIRLINES,
    flights: [{
      id: "00000000-0000-4000-8000-000000000001",
      user_id: USER_ID,
      flight_date: "2026-03-05",
      airline_iata: "FR",
      flight_number: "9142",
      dep_iata: "STN",
      arr_iata: "FAO",
      sched_dep: "2026-03-05T19:30:00Z",
      sched_arr: "2026-03-05T22:30:00Z",
      provider_sched_dep: null,
      provider_sched_arr: null,
      actual_dep: null,
      actual_takeoff: null,
      actual_landing: null,
      actual_arr: null,
      aircraft_type_code: null,
      registration: null,
      cabin_class: null,
      distance_mi: 1000,
      booking_id: null,
      status: "scheduled",
      source: "manual",
      raw_provider: null,
    }],
    aircraft_types: AIRCRAFT_TYPES,
  });

  const csv = [
    "Date,Scheduled Dep Time (Local),Scheduled Arr Time (Local),Actual Dep Time (Local),Actual Arr Time (Local),Aircraft,Registration,Airline,Flight,Dep Airport,Arr Airport,Class",
    "2026-03-05,19:30,22:30,19:29,21:59,B738,EI-EKY,FR,FR9142,STN,FAO,Economy",
  ].join("\n");

  const result = await importCsvFlights(supabase as never, {
    csv_text: csv,
    user_id: USER_ID,
    duplicate_mode: "update_missing",
  });

  assertEquals(result.created, 0);
  assertEquals(result.updated, 1);
  assertEquals(supabase.db.flights[0].actual_dep, "2026-03-05T19:29:00.000Z");
  assertEquals(supabase.db.flights[0].aircraft_type_code, "B738");
  assertEquals(supabase.db.flights[0].registration, "EI-EKY");
  assertEquals(supabase.db.flights[0].source, "manual");
});

Deno.test("importCsvFlights supports overwrite duplicate mode and refresh_after_import", async () => {
  const supabase = createMockSupabaseClient({
    airports: AIRPORTS,
    airlines: AIRLINES,
    flights: [{
      id: "00000000-0000-4000-8000-000000000002",
      user_id: USER_ID,
      flight_date: "2026-03-10",
      airline_iata: "U2",
      flight_number: "8534",
      dep_iata: "FAO",
      arr_iata: "LGW",
      sched_dep: "2026-03-10T19:45:00Z",
      sched_arr: "2026-03-10T22:40:00Z",
      provider_sched_dep: null,
      provider_sched_arr: null,
      actual_dep: null,
      actual_takeoff: null,
      actual_landing: null,
      actual_arr: null,
      aircraft_type_code: null,
      registration: null,
      cabin_class: null,
      distance_mi: 1000,
      booking_id: null,
      status: "scheduled",
      source: "manual",
      raw_provider: null,
    }],
    aircraft_types: AIRCRAFT_TYPES,
  });

  const csv = [
    "Date,Scheduled Dep Time (Local),Scheduled Arr Time (Local),Airline,Flight,Dep Airport,Arr Airport,Aircraft",
    "2026-03-10,19:50,22:35,U2,U28534,FAO,LGW,A319",
  ].join("\n");

  const result = await importCsvFlights(
    supabase as never,
    {
      csv_text: csv,
      user_id: USER_ID,
      duplicate_mode: "overwrite",
      enrichment_mode: "refresh_after_import",
    },
    {
      now: new Date("2026-04-01T00:30:00Z"),
      enrichFlight: async () => ({
        found: true,
        provider: "fr24api",
        flight: {
          actual_takeoff: "2026-03-10T19:52:57Z",
          actual_landing: "2026-03-10T22:27:03Z",
          registration: "G-EZGR",
          aircraft_type_code: "A319",
          raw_provider: { provider: "fr24api" },
        },
        track: {
          geojson: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
          source: "fr24api",
          recorded_at: "2026-03-10T22:27:03Z",
        },
        warnings: [],
      }),
    },
  );

  assertEquals(result.updated, 1);
  assertEquals(result.refreshed, 1);
  assertEquals(supabase.db.flights[0].sched_dep, "2026-03-10T19:50:00.000Z");
  assertEquals(supabase.db.flights[0].aircraft_type_code, "A319");
  assertEquals(supabase.db.flights[0].registration, "G-EZGR");
  assertEquals(supabase.db.tracks.length, 1);
  assertEquals(result.results[0].refresh_outcome, "refreshed");
});

Deno.test("importCsvFlights rejects CSVs missing required columns", async () => {
  const supabase = createMockSupabaseClient({
    airports: AIRPORTS,
    airlines: AIRLINES,
  });

  await assertRejects(
    () =>
      importCsvFlights(supabase as never, {
        csv_text:
          "Date,Scheduled Dep Time (Local),Airline,Flight,Dep Airport,Arr Airport\n2026-03-05,19:30,FR,FR9142,STN,FAO",
      }),
    "CSV is missing required column(s)",
  );
});
