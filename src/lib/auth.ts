import { createClient, type User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// supabase-js client, used only for auth (Google sign-in) and authenticated function
// calls. Public reads still go through the thin restGet client.
export const supabase = createClient(URL, ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname } });
}

export function signOut() {
  return supabase.auth.signOut();
}

// Current signed-in user (null when signed out). `ready` flips true once the initial
// session has been read so the UI doesn't flash the signed-out state.
export function useAuth(): { user: User | null; ready: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  return { user, ready };
}
