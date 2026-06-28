import { createFR24Provider } from "./fr24api.ts";
import { assertEquals } from "../test-helpers.ts";

// A daily route returns several operations in the ±1-day window; the provider must pick
// the one whose takeoff is nearest the scheduled departure (not the first listed), and
// must query a DATE-ALIGNED window anchored on sched_dep (covers overnight flights).
Deno.test("FR24 provider picks the operation nearest the scheduled departure", async () => {
  const summaries = [
    { fr24_id: "d18", flight: "TK352", orig_iata: "IST", dest_iata: "ALA", dest_iata_actual: null, datetime_takeoff: "2026-06-18T21:53:18Z", datetime_landed: "2026-06-19T02:56:04Z", reg: "TC-LPS", type: "A21N", first_seen: "2026-06-18T21:40:00Z" },
    { fr24_id: "d19", flight: "TK352", orig_iata: "IST", dest_iata: "ALA", dest_iata_actual: null, datetime_takeoff: "2026-06-19T22:06:28Z", datetime_landed: null, reg: "TC-LOM", type: "A21N", first_seen: "2026-06-19T21:50:00Z" },
    { fr24_id: "d20", flight: "TK352", orig_iata: "IST", dest_iata: "ALA", dest_iata_actual: null, datetime_takeoff: "2026-06-20T21:56:36Z", datetime_landed: "2026-06-21T02:39:04Z", reg: "TC-LPM", type: "A21N", first_seen: "2026-06-20T21:45:00Z" },
  ];

  let summaryUrl = "";
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/flight-summary/")) {
      summaryUrl = url;
      return Promise.resolve(new Response(JSON.stringify({ data: summaries }), { status: 200 }));
    }
    // track for the chosen op
    if (url.includes("flight_id=d19")) {
      return Promise.resolve(new Response(JSON.stringify([{ fr24_id: "d19", tracks: [
        { lat: 41.2, lon: 28.7, timestamp: "2026-06-19T22:07:00Z" },
        { lat: 43.3, lon: 77.0, timestamp: "2026-06-20T02:24:49Z" },
      ] }]), { status: 200 }));
    }
    return Promise.resolve(new Response("[]", { status: 200 }));
  }) as typeof fetch;

  try {
    const fr24 = createFR24Provider("test-token");
    const res = await fr24({
      flight_date: "2026-06-20",
      airline_iata: "TK",
      flight_number: "352",
      dep_iata: "IST",
      arr_iata: "ALA",
      sched_dep: "2026-06-19T21:40:00Z",
    });

    // chose the 06-19 operation (nearest the 21:40 schedule), not the first or the 06-20
    assertEquals(res.found, true);
    assertEquals(res.flight?.actual_takeoff, "2026-06-19T22:06:28Z");
    assertEquals(res.flight?.registration, "TC-LOM");
    assertEquals(res.track?.recorded_at, "2026-06-20T02:24:49Z");
    // window is date-aligned and anchored on sched_dep (±1 day around 06-19)
    const u = new URL(summaryUrl);
    assertEquals(u.searchParams.get("flight_datetime_from"), "2026-06-18T00:00:00Z");
    assertEquals(u.searchParams.get("flight_datetime_to"), "2026-06-20T23:59:59Z");
  } finally {
    globalThis.fetch = orig;
  }
});
