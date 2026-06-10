// One-off: re-enrich the wrong-day-matched flights with the fixed pickFlight matcher.
// Reads /tmp/wrongday.json (ids), re-queries AeroAPI, validates the new match's local
// departure date == flight_date, then overwrites provider/actual fields + track.
//   deno run --allow-net --allow-env --allow-read scripts/reenrich-wrongday.ts [onlyId]
import { createAeroApiProvider } from "../supabase/functions/_shared/flights/providers/aeroapi.ts";

const SUPA = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AERO = Deno.env.get("AEROAPI_KEY")!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const provider = createAeroApiProvider(AERO);
const onlyId = Deno.args[0];

const wrong = JSON.parse(await Deno.readTextFile("/tmp/wrongday.json")) as { id: string; tag: string }[];
const targets = onlyId ? wrong.filter((w) => w.id === onlyId) : wrong;

// fetch full identity rows + airline icao
const ids = targets.map((t) => t.id);
const rowsRes = await fetch(
  `${SUPA}/rest/v1/v_flights_with_airports?id=in.(${ids.join(",")})&select=id,flight_date,airline_iata,flight_number,dep_iata,arr_iata,source`,
  { headers: H },
);
const flights = await rowsRes.json();
const iatas = [...new Set(flights.map((f: any) => f.airline_iata).filter(Boolean))];
const airRes = await fetch(`${SUPA}/rest/v1/airlines?iata=in.(${iatas.join(",")})&select=iata,icao`, { headers: H });
const icaoBy = new Map<string, string>();
for (const a of await airRes.json()) if (a.iata && a.icao) icaoBy.set(a.iata, a.icao);

const localDate = (iso: string | null, tz: string | null) => {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz ?? "UTC" }).format(new Date(iso));
  } catch {
    return null;
  }
};

let fixed = 0, skipped = 0, failed = 0;
for (const f of flights) {
  try {
    const r = await provider({
      flight_date: f.flight_date,
      airline_iata: f.airline_iata,
      airline_icao: icaoBy.get(f.airline_iata) ?? null,
      flight_number: f.flight_number,
      dep_iata: f.dep_iata,
      arr_iata: f.arr_iata,
      source: f.source,
    } as any);
    if (!r.found || !r.flight) {
      console.log(`SKIP  ${f.airline_iata}${f.flight_number} ${f.flight_date} ${f.dep_iata}-${f.arr_iata}: not found`);
      skipped++;
      continue;
    }
    const m = r.flight;
    const raw = m.raw_provider as any;
    const tz = raw?.origin?.timezone ?? null;
    const newDay = localDate(m.provider_sched_dep ?? m.actual_dep ?? m.provider_sched_takeoff ?? m.actual_takeoff ?? null, tz);
    if (newDay !== f.flight_date) {
      console.log(`SKIP  ${f.airline_iata}${f.flight_number} ${f.flight_date} ${f.dep_iata}-${f.arr_iata}: matcher still got ${newDay}`);
      skipped++;
      continue;
    }
    const row: Record<string, unknown> = {
      provider_sched_dep: m.provider_sched_dep ?? null,
      provider_sched_arr: m.provider_sched_arr ?? null,
      provider_sched_takeoff: m.provider_sched_takeoff ?? null,
      provider_sched_landing: m.provider_sched_landing ?? null,
      actual_dep: m.actual_dep ?? null,
      actual_takeoff: m.actual_takeoff ?? null,
      actual_landing: m.actual_landing ?? null,
      actual_arr: m.actual_arr ?? null,
      aircraft_type_code: m.aircraft_type_code ?? null,
      registration: m.registration ?? null,
      terminal_origin: m.terminal_origin ?? null,
      terminal_destination: m.terminal_destination ?? null,
      gate_origin: m.gate_origin ?? null,
      gate_destination: m.gate_destination ?? null,
      actual_runway_off: m.actual_runway_off ?? null,
      actual_runway_on: m.actual_runway_on ?? null,
      route_distance_mi: m.route_distance_mi ?? null,
      diverted: m.diverted ?? null,
      provider_status: m.provider_status ?? null,
      raw_provider: m.raw_provider ?? null,
      source: "aeroapi",
    };
    if (row.actual_dep || row.actual_takeoff || row.actual_landing || row.actual_arr) row.status = "completed";

    // aircraft FK stub
    if (typeof row.aircraft_type_code === "string" && row.aircraft_type_code) {
      await fetch(`${SUPA}/rest/v1/aircraft_types`, {
        method: "POST",
        headers: { ...H, Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({ code: row.aircraft_type_code, name: row.aircraft_type_code }),
      });
    }
    const up = await fetch(`${SUPA}/rest/v1/flights?id=eq.${f.id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(row) });
    if (!up.ok) throw new Error(`PATCH ${up.status}: ${await up.text()}`);

    if (r.track) {
      await fetch(`${SUPA}/rest/v1/tracks?on_conflict=flight_id`, {
        method: "POST",
        headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ flight_id: f.id, geojson: r.track.geojson, source: r.track.source, recorded_at: r.track.recorded_at }),
      });
    }
    const ad = m.actual_arr ?? m.actual_landing;
    const delay = ad && m.provider_sched_arr ? Math.round((Date.parse(ad) - Date.parse(m.provider_sched_arr)) / 60000) : null;
    console.log(`FIXED ${f.airline_iata}${f.flight_number} ${f.flight_date} ${f.dep_iata}-${f.arr_iata}: day=${newDay} delay=${delay}m track=${r.track ? "y" : "n"}`);
    fixed++;
  } catch (e) {
    console.log(`FAIL  ${f.airline_iata}${f.flight_number} ${f.flight_date}: ${e instanceof Error ? e.message : e}`);
    failed++;
  }
}
console.log(`\nDONE fixed=${fixed} skipped=${skipped} failed=${failed}`);
