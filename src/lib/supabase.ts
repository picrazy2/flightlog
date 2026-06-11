// Thin PostgREST client for public (anon) reads against the v_* views.
import { supabase } from "./auth";

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

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

// Write path: invoke an Edge Function as the signed-in user. supabase-js attaches the
// user's JWT, which the function verifies (and checks against the allowed owner email).
export async function invokeFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error("Sign in to make changes");
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> });
  if (error) throw error;
  return data as T;
}
