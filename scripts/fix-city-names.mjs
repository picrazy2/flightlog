// One-off: strip "(District)" suffixes from airport city names so multi-airport
// cities (e.g. Shanghai SHA+PVG) aggregate as one. Metros whose airport sits in a
// different locality are named explicitly.
const base = process.env.SUPABASE_URL + "/rest/v1/airports";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" };

const cities = {
  SHA: "Shanghai",
  PVG: "Shanghai",
  AGA: "Agadir",
  CAN: "Guangzhou",
  CDG: "Paris",
  CSX: "Changsha",
  CTU: "Chengdu",
  DYG: "Zhangjiajie",
  KWL: "Guilin",
  LHW: "Lanzhou",
  MXP: "Milan",
  PLZ: "Gqeberha",
  SJO: "San José",
  SYD: "Sydney",
  SYX: "Sanya",
  TAO: "Qingdao",
  UBN: "Ulaanbaatar",
  XIY: "Xi'an",
  XNN: "Xining",
};

for (const [iata, city] of Object.entries(cities)) {
  const r = await fetch(`${base}?iata=eq.${iata}`, { method: "PATCH", headers: H, body: JSON.stringify({ city }) });
  console.log(`${r.ok ? "OK " : "FAIL " + r.status + " "}${iata} → ${city}`);
}
