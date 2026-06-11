-- Lock down direct writes via PostgREST. The Edge Functions write with the service
-- role (which bypasses RLS), so enabling RLS with no write policy blocks anyone using
-- the anon/authenticated key from inserting/updating/deleting directly. Reads that the
-- frontend performs directly (bookings, users) keep an explicit public SELECT policy;
-- everything else is read through SECURITY DEFINER views (owner perms bypass RLS).

-- user data
alter table public.flights  enable row level security;
alter table public.tracks   enable row level security;
alter table public.bookings enable row level security;
alter table public.users    enable row level security;

-- reference data (written only by the refresh functions / migrations)
alter table public.airports       enable row level security;
alter table public.airlines       enable row level security;
alter table public.aircraft       enable row level security;
alter table public.aircraft_types enable row level security;
alter table public.countries      enable row level security;

-- the two tables the frontend queries directly need a public read policy
drop policy if exists "bookings public read" on public.bookings;
create policy "bookings public read" on public.bookings for select to anon, authenticated using (true);

drop policy if exists "users public read" on public.users;
create policy "users public read" on public.users for select to anon, authenticated using (true);
