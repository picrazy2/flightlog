-- Map each log's owner to a login/Gmail address. Optional today (writes are gated by
-- the global ALLOWED_EMAILS allow-list), but this is the anchor for later per-user
-- scoping (a signed-in email may only write its own log) and per-user Gmail import
-- (associate a Google OAuth grant with a user).
alter table public.users
  add column if not exists email text;

-- one address per log; null allowed (a log with no linked account yet)
create unique index if not exists users_email_key on public.users (lower(email)) where email is not null;

update public.users set email = 'alexanderguo99@gmail.com' where id = 'alex' and email is null;
