import {
  fetchAircraftRecordByRegistration,
  refreshAircraftByRegistration,
} from "./aircraft.ts";
import {
  assertEquals,
  assertRejects,
} from "../flights/test-helpers.ts";

Deno.test("fetchAircraftRecordByRegistration returns normalized data on success", async () => {
  const record = await fetchAircraftRecordByRegistration("N664UA", {
    apiKey: "test-key",
    fetch: async () =>
      new Response(
        JSON.stringify({
          reg: "N664UA",
          icaoCode: "B763",
          rolloutDate: "1998-06-14",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  assertEquals(record?.registration, "N664UA");
  assertEquals(record?.aircraft_type_code, "B763");
  assertEquals(record?.year_manufactured, 1998);
  assertEquals(record?.country_of_registration, "US");
});

Deno.test("fetchAircraftRecordByRegistration treats 204 as no aircraft record", async () => {
  const record = await fetchAircraftRecordByRegistration("N699UA", {
    apiKey: "test-key",
    fetch: async () => new Response(null, { status: 204 }),
  });

  assertEquals(record, null);
});

Deno.test("fetchAircraftRecordByRegistration retries 429 responses with backoff", async () => {
  let attempts = 0;
  const sleeps: number[] = [];

  const record = await fetchAircraftRecordByRegistration("N664UA", {
    apiKey: "test-key",
    fetch: async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response(
          JSON.stringify({ message: "rate limit" }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ reg: "N664UA", icaoCode: "B763" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  assertEquals(attempts, 3);
  assertEquals(sleeps, [500, 1000]);
  assertEquals(record?.registration, "N664UA");
});

Deno.test("fetchAircraftRecordByRegistration surfaces 403 access denied clearly", async () => {
  await assertRejects(
    () =>
      fetchAircraftRecordByRegistration("N664UA", {
        apiKey: "test-key",
        fetch: async () =>
          new Response(
            JSON.stringify({ message: "blocked" }),
            { status: 403, headers: { "content-type": "application/json" } },
          ),
      }),
    "Aircraft access denied for N664UA: 403",
  );
});

Deno.test("refreshAircraftByRegistration upserts the normalized aircraft row", async () => {
  let upserted: Record<string, unknown> | null = null;
  const supabase = {
    from(table: string) {
      assertEquals(table, "aircraft");
      return {
        upsert(row: Record<string, unknown>) {
          upserted = row;
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const result = await refreshAircraftByRegistration(supabase as never, "G-STBG", {
    apiKey: "test-key",
    fetch: async () =>
      new Response(
        JSON.stringify({
          reg: "G-STBG",
          icaoCode: "B77W",
          deliveryDate: "2018-01-01",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  assertEquals(result.registration, "G-STBG");
  assertEquals(upserted?.["registration"], "G-STBG");
  assertEquals(upserted?.["aircraft_type_code"], "B77W");
  assertEquals(upserted?.["country_of_registration"], "GB");
});
