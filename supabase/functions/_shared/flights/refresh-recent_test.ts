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

Deno.test("refreshRecentFlights does NOT re-query old enriched flights still missing a track", async () => {
  // enriched, no track, arrived long ago (> track-retry window) → must be ineligible
  const supabase = createMockSupabaseClient({
    flights: [
      baseFlight("00000000-0000-4000-8000-000000000099", {
        raw_provider: { provider: "aeroapi" },
        status: "completed",
      }),
    ],
  });

  let called = 0;
  const result = await refreshRecentFlights(
    supabase as never,
    {},
    {
      now: new Date("2026-05-01T00:00:00Z"), // ~6 weeks after the 2026-03-20 arrival
      enrichFlight: async () => {
        called += 1;
        return { found: false, provider: "aeroapi", flight: null, track: null, warnings: [] };
      },
    },
  );

  assertEquals(result.eligible, 0);
  assertEquals(called, 0);
});

Deno.test("refreshRecentFlights re-queries an incompletely-enriched flight within the completion window", async () => {
  // Enriched while still taxiing: has takeoff/landing AND a track, but no gate-in time
  // (actual_arr). Inside the completion-retry window → must be re-queried to backfill it.
  const id = "00000000-0000-4000-8000-000000000077";
  const supabase = createMockSupabaseClient({
    flights: [
      baseFlight(id, {
        actual_takeoff: "2026-03-20T10:20:00Z",
        actual_landing: "2026-03-20T19:50:00Z",
        actual_arr: null,
        provider_status: "Landed / Taxiing", // not yet at gate → still worth retrying
        raw_provider: { provider: "aeroapi" },
        status: "completed",
      }),
    ],
    tracks: [
      {
        flight_id: id,
        geojson: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
        source: "aeroapi",
        recorded_at: "2026-03-20T19:50:00Z",
      },
    ],
  });

  let called = 0;
  const result = await refreshRecentFlights(
    supabase as never,
    {},
    {
      now: new Date("2026-03-20T21:00:00Z"), // 1h after sched_arr → inside completion window
      enrichFlight: async () => {
        called += 1;
        return {
          found: true,
          provider: "aeroapi",
          flight: {
            actual_arr: "2026-03-20T20:02:00Z",
            source: "aeroapi",
            raw_provider: { provider: "aeroapi" },
          },
          track: null,
          warnings: [],
        };
      },
    },
  );

  assertEquals(result.eligible, 1);
  assertEquals(result.refreshed, 1);
  assertEquals(called, 1);
  assertEquals(
    supabase.db.flights.find((f) => f.id === id)?.actual_arr,
    "2026-03-20T20:02:00Z",
  );
});

Deno.test("refreshRecentFlights does NOT re-query a tracked incompletely-enriched flight after the window", async () => {
  // Same shape, but past the completion window AND it already has a track → ineligible.
  // Bounds re-billing for flights whose provider never reports a gate-in time.
  const id = "00000000-0000-4000-8000-000000000078";
  const supabase = createMockSupabaseClient({
    flights: [
      baseFlight(id, {
        actual_takeoff: "2026-03-20T10:20:00Z",
        actual_landing: "2026-03-20T19:50:00Z",
        actual_arr: null,
        raw_provider: { provider: "aeroapi" },
        status: "completed",
      }),
    ],
    tracks: [
      {
        flight_id: id,
        geojson: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
        source: "aeroapi",
        recorded_at: "2026-03-20T19:50:00Z",
      },
    ],
  });

  let called = 0;
  const result = await refreshRecentFlights(
    supabase as never,
    {},
    {
      now: new Date("2026-03-21T09:00:00Z"), // 13h after sched_arr → outside 12h window
      enrichFlight: async () => {
        called += 1;
        return { found: false, provider: "aeroapi", flight: null, track: null, warnings: [] };
      },
    },
  );

  assertEquals(result.eligible, 0);
  assertEquals(called, 0);
});

Deno.test("refreshRecentFlights stops re-querying once the flight has arrived at the gate, even with no gate-in time", async () => {
  // Within the window and missing actual_arr, BUT the provider reports "Arrived / Gate
  // Arrival" — a terminal state. The provider has no gate-in time for this airport
  // (observed at IST/ALA); re-querying can't fill it, so it must be ineligible.
  const id = "00000000-0000-4000-8000-000000000079";
  const supabase = createMockSupabaseClient({
    flights: [
      baseFlight(id, {
        actual_takeoff: "2026-03-20T10:20:00Z",
        actual_landing: "2026-03-20T19:50:00Z",
        actual_arr: null,
        provider_status: "Arrived / Gate Arrival",
        raw_provider: { provider: "aeroapi" },
        status: "completed",
      }),
    ],
    tracks: [
      {
        flight_id: id,
        geojson: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
        source: "aeroapi",
        recorded_at: "2026-03-20T19:50:00Z",
      },
    ],
  });

  let called = 0;
  const result = await refreshRecentFlights(
    supabase as never,
    {},
    {
      now: new Date("2026-03-20T21:00:00Z"), // 1h after sched_arr → inside the window
      enrichFlight: async () => {
        called += 1;
        return { found: false, provider: "aeroapi", flight: null, track: null, warnings: [] };
      },
    },
  );

  assertEquals(result.eligible, 0);
  assertEquals(called, 0);
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

Deno.test("refreshRecentFlights reuses an enriched twin instead of querying the provider", async () => {
  // A second user's copy of the same flight is already enriched (and has a track).
  const twinId = "00000000-0000-4000-8000-0000000000aa";
  const candidateId = "00000000-0000-4000-8000-0000000000bb";
  const supabase = createMockSupabaseClient({
    flights: [
      baseFlight(twinId, {
        user_id: "22222222-2222-4222-8222-222222222222",
        sched_arr: "2026-03-20T19:00:00Z",
        provider_sched_dep: "2026-03-20T10:05:00Z",
        actual_takeoff: "2026-03-20T10:20:00Z",
        actual_landing: "2026-03-20T19:50:00Z",
        aircraft_type_code: "B789",
        registration: "G-ABCD",
        provider_status: "landed",
        raw_provider: { provider: "fr24api" },
      }),
      baseFlight(candidateId, { sched_arr: "2026-03-20T19:00:00Z" }),
    ],
    tracks: [
      {
        id: "00000000-0000-4000-8000-0000000000cc",
        flight_id: twinId,
        geojson: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
        source: "fr24api",
        recorded_at: "2026-03-20T19:50:00Z",
      },
    ],
  });

  let providerCalls = 0;
  const result = await refreshRecentFlights(
    supabase as never,
    {},
    {
      now: new Date("2026-04-01T00:30:00Z"),
      enrichFlight: async () => {
        providerCalls += 1;
        return { found: false, provider: "fr24api", warnings: [] };
      },
    },
  );

  // The unenriched candidate is the only eligible flight; it must reuse, not query.
  assertEquals(result.eligible, 1);
  assertEquals(result.reused, 1);
  assertEquals(result.refreshed, 0);
  assertEquals(providerCalls, 0);

  // Candidate got the twin's provider fields + a cloned track; user schedule untouched.
  const candidate = supabase.db.flights.find((f) => f.id === candidateId)!;
  assertEquals(candidate.registration, "G-ABCD");
  assertEquals(candidate.actual_landing, "2026-03-20T19:50:00Z");
  assertEquals(candidate.provider_status, "landed");
  assertEquals(candidate.sched_dep, "2026-03-20T10:00:00Z");
  assertEquals(supabase.db.tracks.some((t) => t.flight_id === candidateId), true);
});
