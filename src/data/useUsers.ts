import { useQuery } from "@tanstack/react-query";
import { restGet } from "@/lib/supabase";

export interface User {
  id: string;
  name: string;
}

// All users that have a log (drives the header switcher).
export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => restGet<User[]>("users?select=id,name&order=name.asc"),
    staleTime: 5 * 60 * 1000,
  });
}
