import { refreshRecentFlights } from "./refresh-recent.ts";
import {
  assertEquals,
  createMockSupabaseClient,
} from "./test-helpers.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function baseFlight(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    user_id: USER_ID,
    flight_date: "2026-03-20",
    airline_iata: "UA",
    flight_number: "123",
    dep_iata: "JFK",
    arr_iata: "LHR",
    sched_dep: "2026-03-20T10:00:00Z",
    sched_arr: "2026-03-20T20:00:00Z",
    provider_sched_dep: null,
    provider_sched_arr: null,
    actual_dep: null,
    actual_takeoff: null,
    actual_landing: null,
    actual_arr: null,
    aircraft_type_code: null,
    registration: null,
    cabin_class: null,
    distance_mi: 3442,
    booking_id: null,
    status: "scheduled",
    source: "manual",
    raw_provider: null,
    ...overrides,
  };
}

Deno.test("refreshRecentFlights processes only eligible landed flights within the batch limit", async () => {
  const supabase = createMockSupabaseClient({
    flights: [
      baseFlight("00000000-0000-4000-8000-000000000001", {
        sched_arr: "2026-03-20T18:00:00Z",
        flight_number: "101",
      }),
      baseFlight("00000000-0000-4000-8000-000000000002", {
        sched_arr: "2026-03-20T19:00:00Z",
        flight_number: "202",
      }),
      baseFlight("00000000-0000-4000-8000-000000000003", {
        sched_arr: "2026-03-31T23:45:00Z",
      }),
    ],
  });

  const seen: string[] = [];
  const result = await refreshRecentFlights(
    supabase as never,
    { limit: 1 },
    {
      now: new Date("2026-04-01T00:30:00Z"),
      enrichFlight: async (flight) => {
        seen.push(String(flight.flight_number));
        return {
          found: true,
          provider: "fr24api",
          flight: {
            actual_takeoff: "2026-03-20T18:20:00Z",
            actual_landing: "2026-03-20T19:50:00Z",
            source: "fr24api",
            raw_provider: { provider: "fr24api" },
          },
          track: {
            geojson: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
            source: "fr24api",
            recorded_at: "2026-03-20T19:50:00Z",
          },
          warnings: [],
        };
      },
    },
  );

  assertEquals(result.scanned, 3);
  assertEquals(result.eligible, 1);
  assertEquals(result.refreshed, 1);
  assertEquals(seen, ["101"]);
  assertEquals(supabase.db.tracks.length, 1);
});

Deno.test("refreshRecentFlights marks provider-enriched flights without tracks as eligible", async () => {
  const supabase = createMockSupabaseClient({
    flights: [
      baseFlight("00000000-0000-4000-8000-000000000010", {
        actual_takeoff: "2026-03-20T10:20:00Z",
        actual_landing: "2026-03-20T19:50:00Z",
        raw_provider: { provider: "fr24api" },
        status: "completed",
      }),
    ],
  });

  const result = await refreshRecentFlights(
    supabase as never,
    {},
    {
      now: new Date("2026-04-01T00:30:00Z"),
      enrichFlight: async () => ({
        found: true,
        provider: "fr24api",
        flight: {
          provider_sched_dep: "2026-03-20T10:00:00Z",
          provider_sched_arr: "2026-03-20T20:00:00Z",
          actual_takeoff: "2026-03-20T10:20:00Z",
          actual_landing: "2026-03-20T19:50:00Z",
          source: "fr24api",
          raw_provider: { provider: "fr24api" },
        },
        track: {
          geojson: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
          source: "fr24api",
          recorded_at: "2026-03-20T19:50:00Z",
        },
        warnings: [],
      }),
    },
  );

  assertEquals(result.eligible, 1);
  assertEquals(result.refreshed, 1);
  assertEquals(supabase.db.tracks.length, 1);
});

Deno.test("refreshRecentFlights overwrites provider-owned fields but preserves user schedule", async () => {
  const supabase = createMockSupabaseClient({
    flights: [
      baseFlight("00000000-0000-4000-8000-000000000020", {
        actual_dep: "2026-03-20T10:05:00Z",
        registration: "N12345",
        aircraft_type_code: "B738",
        source: "manual",
      }),
    ],
  });

  const result = await refreshRecentFlights(
    supabase as never,
    {},
    {
      now: new Date("2026-04-01T00:30:00Z"),
      enrichFlight: async () => ({
        found: true,
        provider: "fr24api",
        flight: {
          provider_sched_dep: "2026-03-20T10:10:00Z",
          provider_sched_arr: "2026-03-20T19:45:00Z",
          actual_dep: "2026-03-20T10:15:00Z",
          actual_takeoff: "2026-03-20T10:20:00Z",
          actual_landing: "2026-03-20T19:50:00Z",
          registration: "N67890",
          aircraft_type_code: "B763",
          source: "fr24api",
          raw_provider: { provider: "fr24api" },
        },
        track: {
          geojson: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
          source: "fr24api",
          recorded_at: "2026-03-20T19:50:00Z",
        },
        warnings: [],
      }),
    },
  );

  assertEquals(result.refreshed, 1);
  assertEquals(supabase.db.flights[0].sched_dep, "2026-03-20T10:00:00Z");
  assertEquals(supabase.db.flights[0].sched_arr, "2026-03-20T20:00:00Z");
  assertEquals(
    supabase.db.flights[0].provider_sched_dep,
    "2026-03-20T10:10:00Z",
  );
  assertEquals(
    supabase.db.flights[0].provider_sched_arr,
    "2026-03-20T19:45:00Z",
  );
  assertEquals(supabase.db.flights[0].actual_dep, "2026-03-20T10:15:00Z");
  assertEquals(supabase.db.flights[0].actual_takeoff, "2026-03-20T10:20:00Z");
  assertEquals(supabase.db.flights[0].registration, "N67890");
  assertEquals(supabase.db.flights[0].aircraft_type_code, "B763");
  assertEquals(supabase.db.flights[0].source, "manual");
  assertEquals(supabase.db.flights[0].status, "completed");
});

Deno.test("refreshRecentFlights reports not_found results without mutating the flight", async () => {
  const supabase = createMockSupabaseClient({
    flights: [
      baseFlight("00000000-0000-4000-8000-000000000030"),
    ],
  });

  const result = await refreshRecentFlights(
    supabase as never,
    {},
    {
      now: new Date("2026-04-01T00:30:00Z"),
      enrichFlight: async () => ({
        found: false,
        provider: "fr24api",
        flight: null,
        track: null,
        warnings: [],
      }),
    },
  );

  assertEquals(result.not_found, 1);
  assertEquals(supabase.db.flights[0].raw_provider, null);
  assertEquals(supabase.db.tracks.length, 0);
});
