import { createClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./flights/http.ts";

// Verify the request carries a valid Supabase user JWT (a signed-in Google account)
// whose email is allowed to write. Used by the user-facing write functions instead of
// the shared EDGE_FUNCTION_SECRET (which the browser bundle would otherwise expose).
export async function requireAuthedUser(request: Request): Promise<{ email: string }> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Sign in to make changes");

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new HttpError(500, "Missing SUPABASE_URL / SUPABASE_ANON_KEY");

  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  const email = data?.user?.email;
  if (error || !email) throw new HttpError(401, "Unauthorized");

  // optional allow-list: ALLOWED_EMAILS (comma-separated) or fall back to the owner email
  const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? Deno.env.get("GMAIL_OWNER_EMAIL") ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(email.toLowerCase())) throw new HttpError(403, "Not an authorized account");

  return { email };
}
