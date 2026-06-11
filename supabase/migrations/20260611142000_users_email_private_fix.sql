-- 20260611141000 first shipped an ineffective column-only revoke (a table-level SELECT
-- grant overrides it), so email stayed publicly readable on the live DB. Re-apply the
-- effective form here. Idempotent: safe to run on a fresh DB where 141000 already did it.
revoke select on public.users from anon, authenticated;
grant select (id, name) on public.users to anon, authenticated;
