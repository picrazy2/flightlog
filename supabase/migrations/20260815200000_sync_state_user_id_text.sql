-- watch-gmail has failed on every scheduled run since the multi-account change
-- (20260611150000). loadSyncState filters sync_state by users.id, which is a short text
-- slug ('alex' / 'emily'), but sync_state.user_id was left as uuid. Every run returned
--   Failed to load sync state: invalid input syntax for type uuid: "alex"
-- for both mailboxes and scanned zero messages -- silently, because the handler reports
-- per-account errors inside a 200 / ok:true envelope.
--
-- This is the same mismatch 20260612090000 fixed for bookings.user_id; sync_state was
-- missed. Unlike bookings, user_id stays NULLABLE here: watchGmail still supports a null
-- userId (see the "null user_id (cron path)" test), so the nullable + coalesce-sentinel
-- uniqueness scheme is preserved rather than replaced with a not-null default.
--
-- Both existing rows are alex's pre-multi-account cursor and ~100 already-processed
-- message IDs. They are reassigned to 'alex' rather than dropped, so the first working
-- run doesn't re-send every booking email in the lookback window to Gemini.

-- The uniqueness index is an expression index containing a uuid literal, so it cannot be
-- rebuilt automatically by the type change and must be dropped first.
drop index if exists public.sync_state_user_key_unique_idx;

alter table public.sync_state
  alter column user_id type text using user_id::text;

update public.sync_state set user_id = 'alex' where user_id is null;

alter table public.sync_state
  add constraint sync_state_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

-- Sentinel keeps (null, key) unique. '__global__' is not a valid users.id slug, so it
-- cannot collide with a real per-user row.
create unique index sync_state_user_key_unique_idx
  on public.sync_state (coalesce(user_id, '__global__'), key);

create index if not exists sync_state_user_id_idx on public.sync_state (user_id);

comment on column public.sync_state.user_id is
  'Owning users.id slug. Null means global/legacy state shared across mailboxes.';
