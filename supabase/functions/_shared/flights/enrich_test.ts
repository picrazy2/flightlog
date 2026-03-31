import { enrichFlight } from "./enrich.ts";
import {
  assert,
  assertEquals,
  assertRejects,
} from "./test-helpers.ts";

Deno.test("enrichFlight routes near-future flights to AeroAPI", async () => {
  let called = false;

  const result = await enrichFlight(
    {
      flight_date: "2026-04-01",
      airline_iata: "UA",
      flight_number: "123",
    },
    {
      now: new Date("2026-03-31T12:00:00Z"),
      aeroapi: async (request) => {
        called = true;
        assertEquals(request.flight_date, "2026-04-01");
        return {
          found: true,
          provider: "aeroapi",
          flight: { source: "aeroapi" },
          track: null,
          warnings: [],
        };
      },
    },
  );

  assert(called, "Expected AeroAPI provider to be called");
  assertEquals(result.provider, "aeroapi");
  assertEquals(result.flight?.source, "aeroapi");
});

Deno.test("enrichFlight routes recent past flights to FR24", async () => {
  let called = false;

  const result = await enrichFlight(
    {
      flight_date: "2026-03-20",
      airline_iata: "UA",
      flight_number: "123",
    },
    {
      now: new Date("2026-03-31T12:00:00Z"),
      fr24api: async () => {
        called = true;
        return {
          found: true,
          provider: "fr24api",
          flight: { source: "fr24api" },
          track: null,
          warnings: [],
        };
      },
    },
  );

  assert(called, "Expected FR24 provider to be called");
  assertEquals(result.provider, "fr24api");
});

Deno.test("enrichFlight warns when the selected provider is not configured", async () => {
  const result = await enrichFlight(
    {
      flight_date: "2026-04-01",
      airline_iata: "UA",
      flight_number: "123",
    },
    {
      now: new Date("2026-03-31T12:00:00Z"),
    },
  );

  assertEquals(result.found, false);
  assertEquals(result.provider, "aeroapi");
  assertEquals(result.warnings, ["aeroapi enrichment provider is not configured"]);
});

Deno.test("enrichFlight uses AeroAPI for older flights only during backfill mode", async () => {
  let called = false;

  const result = await enrichFlight(
    {
      flight_date: "2026-01-15",
      airline_iata: "UA",
      flight_number: "123",
    },
    {
      now: new Date("2026-03-31T12:00:00Z"),
      aeroapiStandardBackfillActive: true,
      aeroapi: async () => {
        called = true;
        return {
          found: true,
          provider: "aeroapi",
          flight: { source: "aeroapi" },
          track: null,
          warnings: [],
        };
      },
    },
  );

  assert(called, "Expected backfill-mode AeroAPI provider to be called");
  assertEquals(result.provider, "aeroapi");
});

Deno.test("enrichFlight validates flight_date input", async () => {
  await assertRejects(
    () =>
      enrichFlight({
        flight_date: "03/31/2026",
        airline_iata: "UA",
        flight_number: "123",
      }),
    "flight_date must be in YYYY-MM-DD format",
  );
});
