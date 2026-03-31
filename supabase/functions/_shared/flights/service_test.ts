import { createFlight, deleteFlight, updateFlight } from "./service.ts";
import {
  assert,
  assertEquals,
  createMockSupabaseClient,
} from "./test-helpers.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FLIGHT_ID = "22222222-2222-4222-8222-222222222222";

function baseSeed() {
  return {
    airports: [
      { iata: "JFK", latitude: 40.6413, longitude: -73.7781 },
      { iata: "LHR", latitude: 51.47, longitude: -0.4543 },
      { iata: "SFO", latitude: 37.6213, longitude: -122.379 },
    ],
    airlines: [{ iata: "UA" }],
  };
}

Deno.test("createFlight enriches on demand and stores track data", async () => {
  const supabase = createMockSupabaseClient(baseSeed());
  let enrichCalls = 0;

  const result = await createFlight(
    supabase as never,
    {
      user_id: USER_ID,
      flight_date: "2026-03-20",
      airline_iata: "UA",
      flight_number: "123",
      dep_iata: "JFK",
      arr_iata: "LHR",
      sched_dep: "2026-03-20T10:00:00Z",
      sched_arr: "2026-03-20T20:00:00Z",
      enrichment_mode: "try_now",
    },
    {
      enrichFlight: async () => {
        enrichCalls += 1;
        return {
          found: true,
          provider: "fr24api",
          flight: {
            provider_sched_dep: "2026-03-20T10:05:00Z",
            provider_sched_arr: "2026-03-20T19:55:00Z",
            actual_dep: "2026-03-20T10:15:00Z",
            actual_takeoff: "2026-03-20T10:30:00Z",
            actual_landing: "2026-03-20T19:35:00Z",
            actual_arr: "2026-03-20T19:50:00Z",
            source: "fr24api",
            raw_provider: { provider: "fr24api" },
          },
          track: {
            geojson: {
              type: "LineString",
              coordinates: [[-73.7781, 40.6413], [-0.4543, 51.47]],
            },
            source: "fr24api",
            recorded_at: "2026-03-20T19:35:00Z",
          },
          warnings: ["scheduled times unavailable from FR24"],
        };
      },
    },
  );

  assertEquals(enrichCalls, 1);
  assertEquals(result.warnings, ["scheduled times unavailable from FR24"]);
  assertEquals(result.flight.source, "fr24api");
  assertEquals(result.track?.source, "fr24api");
  assertEquals(supabase.db.flights.length, 1);
  assertEquals(supabase.db.tracks.length, 1);
  assertEquals(
    supabase.db.flights[0].provider_sched_dep,
    "2026-03-20T10:05:00.000Z",
  );
  assertEquals(
    supabase.db.flights[0].provider_sched_arr,
    "2026-03-20T19:55:00.000Z",
  );
  assert(supabase.db.flights[0].distance_mi === 3442, "Expected JFK-LHR distance");
});

Deno.test("createFlight skips enrichment when the payload is already enriched", async () => {
  const supabase = createMockSupabaseClient(baseSeed());
  let enrichCalls = 0;

  const result = await createFlight(
    supabase as never,
    {
      enrichment_mode: "try_now",
      flight: {
        user_id: USER_ID,
        flight_date: "2026-03-21",
        airline_iata: "UA",
        flight_number: "123",
        dep_iata: "JFK",
        arr_iata: "LHR",
        sched_dep: "2026-03-21T10:00:00Z",
        sched_arr: "2026-03-21T20:00:00Z",
        provider_sched_dep: "2026-03-21T10:00:00Z",
        provider_sched_arr: "2026-03-21T20:00:00Z",
        source: "fr24api",
        raw_provider: { provider: "fr24api" },
      },
      track: {
        geojson: {
          type: "LineString",
          coordinates: [[-73.7781, 40.6413], [-0.4543, 51.47]],
        },
        source: "fr24api",
        recorded_at: "2026-03-21T19:35:00Z",
      },
    },
    {
      enrichFlight: async () => {
        enrichCalls += 1;
        throw new Error("enrichFlight should not be called");
      },
    },
  );

  assertEquals(enrichCalls, 0);
  assertEquals(result.flight.source, "fr24api");
  assertEquals(supabase.db.flights.length, 1);
  assertEquals(supabase.db.tracks.length, 1);
});

Deno.test("updateFlight and deleteFlight mutate persisted records", async () => {
  const supabase = createMockSupabaseClient({
    ...baseSeed(),
    flights: [{
      id: FLIGHT_ID,
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
    }],
  });

  const updated = await updateFlight(
    supabase as never,
    {
      id: FLIGHT_ID,
      arr_iata: "SFO",
      sched_arr: "2026-03-20T16:00:00Z",
      cabin_class: "economy",
    },
  );

  assertEquals(updated.flight.arr_iata, "SFO");
  assertEquals(updated.flight.cabin_class, "economy");
  assertEquals(supabase.db.flights[0].arr_iata, "SFO");
  assertEquals(supabase.db.flights[0].distance_mi, 2580);

  const deleted = await deleteFlight(supabase as never, FLIGHT_ID);
  assertEquals(deleted.id, FLIGHT_ID);
  assertEquals(supabase.db.flights.length, 0);
  assertEquals(supabase.db.v_flights_with_airports.length, 0);
});
