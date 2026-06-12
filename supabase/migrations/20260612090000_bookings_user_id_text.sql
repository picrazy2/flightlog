-- bookings.user_id was left as an unused uuid column when flights.user_id was migrated
-- to a short text slug (20260610120100). That mismatch makes every booking insert for a
-- non-default user fail ("invalid input syntax for type uuid: emily"), silently breaking
-- the Gmail import / backfill for any user but the default. All 202 existing bookings have
-- a null user_id, so drop and re-add as text (FK to users.id), mirroring flights.
alter table public.bookings drop column if exists user_id;
alter table public.bookings add column user_id text not null default 'alex' references public.users(id);
create index if not exists bookings_user_id_idx on public.bookings (user_id);
