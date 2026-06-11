-- Per-user Gmail credentials so watch-gmail can import each person's bookings into
-- their own log. The shared Google OAuth client id/secret and the Gemini key stay as
-- function env vars; only the refresh token + mailbox identity differ per user.
--
-- The legacy/primary owner (alex) keeps using the GOOGLE_REFRESH_TOKEN env var and is
-- NOT stored here — watch-gmail treats the env token as the GMAIL_OWNER_USER_ID account
-- and merges it with these rows. Add a row here for every additional person.
create table if not exists public.gmail_accounts (
  user_id       text primary key references public.users(id) on delete cascade,
  refresh_token text not null,
  email         text,        -- mailbox / notification address + Gemini "owner" hint
  name          text,        -- owner display name for the parser
  enabled       boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Secrets: only the service role (edge functions) may read/write. No public policies,
-- so anon/authenticated get nothing even though RLS is on.
alter table public.gmail_accounts enable row level security;
