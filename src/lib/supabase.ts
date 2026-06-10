// Thin PostgREST client (no supabase-js dependency needed for read-only access).
// Reads go through the anon key against v_flights_with_airports.
const URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const EDGE_SECRET = import.meta.env.VITE_EDGE_FUNCTION_SECRET as string | undefined;

if (!URL || !ANON) {
  // eslint-disable-next-line no-console
  console.warn("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see .env.example");
}

export async function restGet<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  if (!res.ok) throw new Error(`REST ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Write path: invoke an edge function with the build-time bearer secret.
export async function invokeFunction<T>(name: string, body: unknown): Promise<T> {
  if (!EDGE_SECRET) throw new Error("VITE_EDGE_FUNCTION_SECRET not set — writes disabled");
  const res = await fetch(`${URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${EDGE_SECRET}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`fn ${name} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const writesEnabled = Boolean(EDGE_SECRET);
