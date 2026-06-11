-- public.users is publicly readable (the log switcher needs id/name), but the email
-- column must not leak via PostgREST. A column-level revoke does NOT override the
-- existing table-level SELECT grant, so drop the table grant and re-grant only the
-- public columns. Row access is still governed by the existing select policy; the
-- service role bypasses all of this for writes.
revoke select on public.users from anon, authenticated;
grant select (id, name) on public.users to anon, authenticated;
